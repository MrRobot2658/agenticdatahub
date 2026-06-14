"""08 · monitor —— 投递监控 / 指标聚合 / 告警 后端模块

对标 Twilio Segment 的 Monitor / Delivery Overview / Sources Debugger：
事件投递逐条日志、分钟桶指标聚合、告警规则与触发记录。

只做加法：不 import / 修改 main.py / schemas.py / 既有 service。
本文件自包含：Pydantic 模型 + Service 类 + APIRouter（变量名 router）。
所有 SQL 参数化，所有操作按 tenant_id 隔离。monitor 模块为可观测性指标，
不涉及圈人/受众筛选，故无需走 objects.build_sql / dsl 路径。

挂载方式（main.py）：
    from monitor_api import router as monitor_router
    app.include_router(monitor_router)
"""

import json
from contextlib import contextmanager
from typing import Any

import pymysql
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from executor import MysqlOlapExecutor

# ════════════════════════════════════════════════════════════════════════
# Pydantic 模型
# ════════════════════════════════════════════════════════════════════════


class MetricUpsert(BaseModel):
    """写入/累加一个分钟（或小时）桶的聚合指标（供模拟/采集端调用）。"""

    bucket_ts: str = Field(..., description="桶时间戳，如 2026-06-14 10:00:00")
    source: str = Field("", max_length=128, description="数据源名称")
    events_total: int = Field(0, ge=0)
    success_count: int = Field(0, ge=0)
    failed_count: int = Field(0, ge=0)
    latency_ms_p50: int | None = None
    latency_ms_p95: int | None = None
    latency_ms_p99: int | None = None


class DeliveryLogCreate(BaseModel):
    """记录一条逐事件投递日志。"""

    ts: str | None = Field(None, description="事件处理时刻，缺省取 NOW()")
    source: str = Field(..., max_length=128, description="数据源名称")
    event_name: str | None = Field(None, max_length=256)
    destination: str | None = Field(None, max_length=256)
    status: str = Field("success", description="success/failed/retry/skipped")
    http_code: int | None = None
    latency_ms: int | None = None
    error_message: str | None = Field(None, max_length=512)
    event_id: str | None = Field(None, max_length=256)
    detail: dict | None = None


class AlertRuleCreate(BaseModel):
    name: str = Field(..., max_length=256, description="规则名称")
    metric: str = Field(..., max_length=64, description="success_rate/event_count/error_rate/latency_p95")
    operator: str = Field(..., max_length=32, description="lt/gt/eq/gte/lte")
    threshold: float = Field(..., description="阈值")
    window_minutes: int = Field(5, ge=1, description="评估窗口（分钟）")
    scope: str | None = Field(None, max_length=64, description="all_sources/specific_source/specific_destination")
    scope_value: str | None = Field(None, max_length=256)
    channel: str = Field(..., max_length=128, description="email/feishu/webhook")
    channel_config: dict | None = None
    severity: str = Field("medium", description="high/medium/low")
    enabled: bool = True


class AlertRuleUpdate(BaseModel):
    name: str | None = Field(None, max_length=256)
    metric: str | None = Field(None, max_length=64)
    operator: str | None = Field(None, max_length=32)
    threshold: float | None = None
    window_minutes: int | None = Field(None, ge=1)
    scope: str | None = Field(None, max_length=64)
    scope_value: str | None = Field(None, max_length=256)
    channel: str | None = Field(None, max_length=128)
    channel_config: dict | None = None
    severity: str | None = None
    enabled: bool | None = None


class AlertEventCreate(BaseModel):
    """手动/采集端记录一次告警触发。"""

    rule_id: int = Field(..., description="关联 monitor_alert_rule.id")
    fired_at: str | None = Field(None, description="触发时刻，缺省 NOW()")
    metric_value: float | None = None
    detail: dict | None = None


class AlertAck(BaseModel):
    acknowledged_by: str | None = Field(None, max_length=128)


# ════════════════════════════════════════════════════════════════════════
# Service
# ════════════════════════════════════════════════════════════════════════


class MonitorService:
    def __init__(self, executor: MysqlOlapExecutor | None = None):
        self._executor = executor or MysqlOlapExecutor()
        self.config = self._executor.config

    @contextmanager
    def _conn(self):
        conn = pymysql.connect(**self.config, autocommit=True)
        try:
            yield conn
        finally:
            conn.close()

    @staticmethod
    def _loads(row: dict | None, *keys: str) -> dict | None:
        if not row:
            return None
        for k in keys:
            if k in row and isinstance(row[k], str):
                try:
                    row[k] = json.loads(row[k])
                except (json.JSONDecodeError, TypeError):
                    pass
        return row

    # ---------- 指标 monitor_metrics ----------

    def upsert_metric(self, tenant_id: int, data: MetricUpsert) -> dict:
        """按 (tenant_id, bucket_ts, source) 累加桶内计数，延迟分位取最新值。"""
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO monitor_metrics
                    (tenant_id, bucket_ts, source, events_total, success_count, failed_count,
                     latency_ms_p50, latency_ms_p95, latency_ms_p99)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    events_total  = events_total  + VALUES(events_total),
                    success_count = success_count + VALUES(success_count),
                    failed_count  = failed_count  + VALUES(failed_count),
                    latency_ms_p50 = COALESCE(VALUES(latency_ms_p50), latency_ms_p50),
                    latency_ms_p95 = COALESCE(VALUES(latency_ms_p95), latency_ms_p95),
                    latency_ms_p99 = COALESCE(VALUES(latency_ms_p99), latency_ms_p99)
                """,
                (
                    tenant_id, data.bucket_ts, data.source,
                    data.events_total, data.success_count, data.failed_count,
                    data.latency_ms_p50, data.latency_ms_p95, data.latency_ms_p99,
                ),
            )
            cur.execute(
                "SELECT * FROM monitor_metrics WHERE tenant_id=%s AND bucket_ts=%s AND source=%s",
                (tenant_id, data.bucket_ts, data.source),
            )
            return cur.fetchone()

    def list_metrics(
        self,
        tenant_id: int,
        source: str | None = None,
        start: str | None = None,
        end: str | None = None,
        limit: int = 500,
    ) -> list[dict]:
        """时间序列：按桶升序返回，供折线图。"""
        limit = min(max(limit, 1), 2000)
        sql = "SELECT * FROM monitor_metrics WHERE tenant_id=%s"
        params: list[Any] = [tenant_id]
        if source:
            sql += " AND source=%s"; params.append(source)
        if start:
            sql += " AND bucket_ts >= %s"; params.append(start)
        if end:
            sql += " AND bucket_ts <= %s"; params.append(end)
        sql += " ORDER BY bucket_ts ASC LIMIT %s"
        params.append(limit)
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())

    def overview(
        self,
        tenant_id: int,
        source: str | None = None,
        window_minutes: int = 60,
    ) -> dict:
        """聚合 KPI：近 window 分钟的事件总数 / 成功率 / 失败数 / 平均 p95。"""
        window_minutes = min(max(window_minutes, 1), 60 * 24 * 30)
        sql = (
            "SELECT COALESCE(SUM(events_total),0) AS events_total, "
            "COALESCE(SUM(success_count),0) AS success_count, "
            "COALESCE(SUM(failed_count),0) AS failed_count, "
            "AVG(latency_ms_p50) AS avg_p50, AVG(latency_ms_p95) AS avg_p95, "
            "AVG(latency_ms_p99) AS avg_p99, COUNT(*) AS bucket_count "
            "FROM monitor_metrics "
            "WHERE tenant_id=%s AND bucket_ts >= NOW() - INTERVAL %s MINUTE"
        )
        params: list[Any] = [tenant_id, window_minutes]
        if source:
            sql += " AND source=%s"; params.append(source)
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone() or {}
        total = int(row.get("events_total") or 0)
        success = int(row.get("success_count") or 0)
        failed = int(row.get("failed_count") or 0)
        success_rate = round(success / total * 100, 2) if total else None
        error_rate = round(failed / total * 100, 2) if total else None
        return {
            "tenant_id": tenant_id,
            "source": source,
            "window_minutes": window_minutes,
            "events_total": total,
            "success_count": success,
            "failed_count": failed,
            "success_rate": success_rate,
            "error_rate": error_rate,
            "avg_latency_p50": float(row["avg_p50"]) if row.get("avg_p50") is not None else None,
            "avg_latency_p95": float(row["avg_p95"]) if row.get("avg_p95") is not None else None,
            "avg_latency_p99": float(row["avg_p99"]) if row.get("avg_p99") is not None else None,
            "bucket_count": int(row.get("bucket_count") or 0),
        }

    def list_sources(self, tenant_id: int) -> list[dict]:
        """各数据源近况汇总，供监控总览的数据源卡片。"""
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT source,
                       COALESCE(SUM(events_total),0)  AS events_total,
                       COALESCE(SUM(success_count),0) AS success_count,
                       COALESCE(SUM(failed_count),0)  AS failed_count,
                       MAX(bucket_ts)                 AS last_bucket_ts
                FROM monitor_metrics
                WHERE tenant_id=%s
                GROUP BY source
                ORDER BY events_total DESC
                """,
                (tenant_id,),
            )
            rows = list(cur.fetchall())
        for r in rows:
            total = int(r.get("events_total") or 0)
            r["success_rate"] = round(int(r.get("success_count") or 0) / total * 100, 2) if total else None
        return rows

    # ---------- 投递日志 event_delivery_log ----------

    def create_delivery_log(self, tenant_id: int, data: DeliveryLogCreate) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO event_delivery_log
                    (tenant_id, ts, source, event_name, destination, status,
                     http_code, latency_ms, error_message, event_id, detail)
                VALUES (%s, COALESCE(%s, NOW()), %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    tenant_id, data.ts, data.source, data.event_name, data.destination,
                    data.status, data.http_code, data.latency_ms, data.error_message,
                    data.event_id, json.dumps(data.detail or {}, ensure_ascii=False),
                ),
            )
            cur.execute("SELECT * FROM event_delivery_log WHERE id = LAST_INSERT_ID()")
            return self._loads(cur.fetchone(), "detail")

    def list_delivery_logs(
        self,
        tenant_id: int,
        source: str | None = None,
        destination: str | None = None,
        status: str | None = None,
        event_name: str | None = None,
        start: str | None = None,
        end: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        limit = min(max(limit, 1), 1000)
        sql = "SELECT * FROM event_delivery_log WHERE tenant_id=%s"
        params: list[Any] = [tenant_id]
        if source:
            sql += " AND source=%s"; params.append(source)
        if destination:
            sql += " AND destination=%s"; params.append(destination)
        if status:
            sql += " AND status=%s"; params.append(status)
        if event_name:
            sql += " AND event_name=%s"; params.append(event_name)
        if start:
            sql += " AND ts >= %s"; params.append(start)
        if end:
            sql += " AND ts <= %s"; params.append(end)
        sql += " ORDER BY ts DESC LIMIT %s"
        params.append(limit)
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return [self._loads(r, "detail") for r in cur.fetchall()]

    def delivery_stats(
        self,
        tenant_id: int,
        group_by: str = "status",
        window_minutes: int = 60,
    ) -> list[dict]:
        """按 status / source / destination 分组统计投递日志。"""
        window_minutes = min(max(window_minutes, 1), 60 * 24 * 30)
        allowed = {"status": "status", "source": "source", "destination": "destination", "event_name": "event_name"}
        col = allowed.get(group_by)
        if not col:
            raise ValueError(f"不支持的分组维度: {group_by}")
        # col 来自白名单常量，非用户原始串拼接
        sql = (
            f"SELECT {col} AS dimension, COUNT(*) AS cnt, "
            "SUM(status='success') AS success_count, SUM(status='failed') AS failed_count, "
            "AVG(latency_ms) AS avg_latency "
            "FROM event_delivery_log "
            "WHERE tenant_id=%s AND ts >= NOW() - INTERVAL %s MINUTE "
            f"GROUP BY {col} ORDER BY cnt DESC"
        )
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, (tenant_id, window_minutes))
            rows = list(cur.fetchall())
        for r in rows:
            if r.get("avg_latency") is not None:
                r["avg_latency"] = float(r["avg_latency"])
        return rows

    # ---------- 告警规则 monitor_alert_rule ----------

    def create_rule(self, tenant_id: int, data: AlertRuleCreate) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO monitor_alert_rule
                    (tenant_id, name, metric, operator, threshold, window_minutes,
                     scope, scope_value, channel, channel_config, severity, enabled)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    tenant_id, data.name, data.metric, data.operator, data.threshold,
                    data.window_minutes, data.scope, data.scope_value, data.channel,
                    json.dumps(data.channel_config or {}, ensure_ascii=False),
                    data.severity, 1 if data.enabled else 0,
                ),
            )
            cur.execute("SELECT * FROM monitor_alert_rule WHERE id = LAST_INSERT_ID()")
            return self._loads(cur.fetchone(), "channel_config")

    def list_rules(self, tenant_id: int, enabled: bool | None = None) -> list[dict]:
        sql = "SELECT * FROM monitor_alert_rule WHERE tenant_id=%s"
        params: list[Any] = [tenant_id]
        if enabled is not None:
            sql += " AND enabled=%s"; params.append(1 if enabled else 0)
        sql += " ORDER BY id DESC"
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return [self._loads(r, "channel_config") for r in cur.fetchall()]

    def get_rule(self, tenant_id: int, rule_id: int) -> dict | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM monitor_alert_rule WHERE tenant_id=%s AND id=%s",
                (tenant_id, rule_id),
            )
            return self._loads(cur.fetchone(), "channel_config")

    def update_rule(self, tenant_id: int, rule_id: int, data: AlertRuleUpdate) -> dict | None:
        fields, params = [], []
        simple = {
            "name": data.name, "metric": data.metric, "operator": data.operator,
            "threshold": data.threshold, "window_minutes": data.window_minutes,
            "scope": data.scope, "scope_value": data.scope_value,
            "channel": data.channel, "severity": data.severity,
        }
        for col, val in simple.items():
            if val is not None:
                fields.append(f"{col}=%s"); params.append(val)
        if data.channel_config is not None:
            fields.append("channel_config=%s")
            params.append(json.dumps(data.channel_config, ensure_ascii=False))
        if data.enabled is not None:
            fields.append("enabled=%s"); params.append(1 if data.enabled else 0)
        if not fields:
            return self.get_rule(tenant_id, rule_id)
        params.extend([tenant_id, rule_id])
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"UPDATE monitor_alert_rule SET {', '.join(fields)} WHERE tenant_id=%s AND id=%s",
                params,
            )
        return self.get_rule(tenant_id, rule_id)

    def delete_rule(self, tenant_id: int, rule_id: int) -> bool:
        with self._conn() as conn, conn.cursor() as cur:
            # 触发记录有 ON DELETE CASCADE 外键，先删规则即可级联
            cur.execute(
                "DELETE FROM monitor_alert_rule WHERE tenant_id=%s AND id=%s",
                (tenant_id, rule_id),
            )
            return cur.rowcount > 0

    # ---------- 告警触发 monitor_alert_event ----------

    def create_event(self, tenant_id: int, data: AlertEventCreate) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO monitor_alert_event
                    (tenant_id, rule_id, fired_at, metric_value, status, detail)
                VALUES (%s, %s, COALESCE(%s, NOW()), %s, 'triggered', %s)
                """,
                (
                    tenant_id, data.rule_id, data.fired_at, data.metric_value,
                    json.dumps(data.detail or {}, ensure_ascii=False),
                ),
            )
            cur.execute("SELECT * FROM monitor_alert_event WHERE id = LAST_INSERT_ID()")
            return self._loads(cur.fetchone(), "detail")

    def list_events(
        self,
        tenant_id: int,
        rule_id: int | None = None,
        status: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        limit = min(max(limit, 1), 500)
        sql = (
            "SELECT e.*, r.name AS rule_name, r.metric, r.severity "
            "FROM monitor_alert_event e "
            "LEFT JOIN monitor_alert_rule r ON e.rule_id=r.id AND r.tenant_id=e.tenant_id "
            "WHERE e.tenant_id=%s"
        )
        params: list[Any] = [tenant_id]
        if rule_id is not None:
            sql += " AND e.rule_id=%s"; params.append(rule_id)
        if status:
            sql += " AND e.status=%s"; params.append(status)
        sql += " ORDER BY e.fired_at DESC LIMIT %s"
        params.append(limit)
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return [self._loads(r, "detail") for r in cur.fetchall()]

    def get_event(self, tenant_id: int, event_id: int) -> dict | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM monitor_alert_event WHERE tenant_id=%s AND id=%s",
                (tenant_id, event_id),
            )
            return self._loads(cur.fetchone(), "detail")

    def acknowledge_event(self, tenant_id: int, event_id: int, by: str | None) -> dict | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE monitor_alert_event
                SET status='acknowledged', acknowledged_at=NOW(), acknowledged_by=%s
                WHERE tenant_id=%s AND id=%s AND status='triggered'
                """,
                (by, tenant_id, event_id),
            )
        return self.get_event(tenant_id, event_id)

    def resolve_event(self, tenant_id: int, event_id: int) -> dict | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE monitor_alert_event
                SET status='resolved', resolved_at=NOW()
                WHERE tenant_id=%s AND id=%s AND status<>'resolved'
                """,
                (tenant_id, event_id),
            )
        return self.get_event(tenant_id, event_id)

    # ---------- 规则评估（按当前指标判定是否触发） ----------

    def evaluate_rule(self, tenant_id: int, rule_id: int, fire: bool = True) -> dict:
        """按规则窗口聚合指标，计算指标值并判定是否越界；越界且 fire 时落库触发记录。"""
        rule = self.get_rule(tenant_id, rule_id)
        if not rule:
            raise ValueError("告警规则不存在")
        source = rule.get("scope_value") if rule.get("scope") == "specific_source" else None
        ov = self.overview(tenant_id, source=source, window_minutes=int(rule["window_minutes"]))
        metric_map = {
            "success_rate": ov["success_rate"],
            "error_rate": ov["error_rate"],
            "event_count": ov["events_total"],
            "latency_p95": ov["avg_latency_p95"],
        }
        metric_value = metric_map.get(rule["metric"])
        breached = False
        if metric_value is not None:
            breached = self._compare(float(metric_value), rule["operator"], float(rule["threshold"]))
        result = {
            "rule_id": rule_id,
            "metric": rule["metric"],
            "operator": rule["operator"],
            "threshold": float(rule["threshold"]),
            "metric_value": metric_value,
            "breached": breached,
            "window_minutes": rule["window_minutes"],
            "fired_event": None,
        }
        if breached and fire:
            ev = self.create_event(
                tenant_id,
                AlertEventCreate(
                    rule_id=rule_id,
                    metric_value=metric_value,
                    detail={"metric": rule["metric"], "threshold": float(rule["threshold"]), "overview": ov},
                ),
            )
            result["fired_event"] = ev
        return result

    @staticmethod
    def _compare(value: float, operator: str, threshold: float) -> bool:
        op = (operator or "").lower()
        if op in ("lt", "<"):
            return value < threshold
        if op in ("lte", "<="):
            return value <= threshold
        if op in ("gt", ">"):
            return value > threshold
        if op in ("gte", ">="):
            return value >= threshold
        if op in ("eq", "=", "=="):
            return value == threshold
        return False


# ════════════════════════════════════════════════════════════════════════
# Router
# ════════════════════════════════════════════════════════════════════════

router = APIRouter(prefix="/monitor", tags=["monitor"])
_service = MonitorService()


# ---- 指标 / 总览 ----

@router.get("/overview")
def api_overview(
    tenant_id: int = Query(...),
    source: str | None = Query(None),
    window_minutes: int = Query(60),
):
    return _service.overview(tenant_id, source, window_minutes)


@router.get("/metrics")
def api_list_metrics(
    tenant_id: int = Query(...),
    source: str | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
    limit: int = Query(500),
):
    return _service.list_metrics(tenant_id, source, start, end, limit)


@router.post("/metrics")
def api_upsert_metric(body: MetricUpsert, tenant_id: int = Query(...)):
    return _service.upsert_metric(tenant_id, body)


@router.get("/sources")
def api_list_sources(tenant_id: int = Query(...)):
    return _service.list_sources(tenant_id)


# ---- 投递日志 ----

@router.get("/delivery-logs")
def api_list_delivery_logs(
    tenant_id: int = Query(...),
    source: str | None = Query(None),
    destination: str | None = Query(None),
    status: str | None = Query(None),
    event_name: str | None = Query(None),
    start: str | None = Query(None),
    end: str | None = Query(None),
    limit: int = Query(100),
):
    return _service.list_delivery_logs(
        tenant_id, source, destination, status, event_name, start, end, limit
    )


@router.post("/delivery-logs")
def api_create_delivery_log(body: DeliveryLogCreate, tenant_id: int = Query(...)):
    return _service.create_delivery_log(tenant_id, body)


@router.get("/delivery-stats")
def api_delivery_stats(
    tenant_id: int = Query(...),
    group_by: str = Query("status"),
    window_minutes: int = Query(60),
):
    try:
        return _service.delivery_stats(tenant_id, group_by, window_minutes)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---- 告警规则 ----

@router.get("/alert-rules")
def api_list_rules(tenant_id: int = Query(...), enabled: bool | None = Query(None)):
    return _service.list_rules(tenant_id, enabled)


@router.post("/alert-rules")
def api_create_rule(body: AlertRuleCreate, tenant_id: int = Query(...)):
    return _service.create_rule(tenant_id, body)


@router.get("/alert-rules/{rule_id}")
def api_get_rule(rule_id: int, tenant_id: int = Query(...)):
    row = _service.get_rule(tenant_id, rule_id)
    if not row:
        raise HTTPException(404, "告警规则不存在")
    return row


@router.put("/alert-rules/{rule_id}")
def api_update_rule(rule_id: int, body: AlertRuleUpdate, tenant_id: int = Query(...)):
    if not _service.get_rule(tenant_id, rule_id):
        raise HTTPException(404, "告警规则不存在")
    return _service.update_rule(tenant_id, rule_id, body)


@router.delete("/alert-rules/{rule_id}")
def api_delete_rule(rule_id: int, tenant_id: int = Query(...)):
    if not _service.delete_rule(tenant_id, rule_id):
        raise HTTPException(404, "告警规则不存在")
    return {"deleted": True, "id": rule_id}


@router.post("/alert-rules/{rule_id}/evaluate")
def api_evaluate_rule(rule_id: int, tenant_id: int = Query(...), fire: bool = Query(True)):
    try:
        return _service.evaluate_rule(tenant_id, rule_id, fire)
    except ValueError as e:
        raise HTTPException(404, str(e))


# ---- 告警触发记录 ----

@router.get("/alert-events")
def api_list_events(
    tenant_id: int = Query(...),
    rule_id: int | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(100),
):
    return _service.list_events(tenant_id, rule_id, status, limit)


@router.post("/alert-events")
def api_create_event(body: AlertEventCreate, tenant_id: int = Query(...)):
    if not _service.get_rule(tenant_id, body.rule_id):
        raise HTTPException(404, "告警规则不存在")
    return _service.create_event(tenant_id, body)


@router.get("/alert-events/{event_id}")
def api_get_event(event_id: int, tenant_id: int = Query(...)):
    row = _service.get_event(tenant_id, event_id)
    if not row:
        raise HTTPException(404, "告警记录不存在")
    return row


@router.post("/alert-events/{event_id}/acknowledge")
def api_acknowledge_event(event_id: int, body: AlertAck, tenant_id: int = Query(...)):
    if not _service.get_event(tenant_id, event_id):
        raise HTTPException(404, "告警记录不存在")
    return _service.acknowledge_event(tenant_id, event_id, body.acknowledged_by)


@router.post("/alert-events/{event_id}/resolve")
def api_resolve_event(event_id: int, tenant_id: int = Query(...)):
    if not _service.get_event(tenant_id, event_id):
        raise HTTPException(404, "告警记录不存在")
    return _service.resolve_event(tenant_id, event_id)
