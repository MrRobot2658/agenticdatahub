"""06 · protocols 模块 — 埋点计划 / 事件 schema / 数据质量违规 / 事件转换规则

对标 Twilio Segment 的 Protocols：Tracking Plans、Violations、Transformations。
本文件自包含：Pydantic 模型 + Service 类 + APIRouter（变量名 router）。
只做加法：不 import/修改 main.py / schemas.py / 既有 service。
所有 SQL 参数化，所有操作按 tenant_id 隔离。
"""

import json
from contextlib import contextmanager

import pymysql
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from executor import MysqlOlapExecutor

# ════════════════════════════════════════════════════════════════════════
# Pydantic 模型
# ════════════════════════════════════════════════════════════════════════


class TrackingPlanCreate(BaseModel):
    name: str = Field(..., max_length=128, description="埋点计划名")
    description: str | None = Field(None, max_length=512)
    sources: list[str] | None = Field(None, description="数据源列表，如 ['app','web','小程序']")
    enabled: bool = True


class TrackingPlanUpdate(BaseModel):
    name: str | None = Field(None, max_length=128)
    description: str | None = Field(None, max_length=512)
    sources: list[str] | None = None
    enabled: bool | None = None


class PlanEventCreate(BaseModel):
    event: str = Field(..., max_length=128, description="事件名，如 Order Completed")
    type: str = Field("track", description="track | identify")
    properties_json: dict | None = Field(None, description='{"property_name":"type",...}')
    required: list[str] | None = Field(None, description="必填属性名列表")
    status: str = Field("draft", description="draft | approved")


class PlanEventUpdate(BaseModel):
    event: str | None = Field(None, max_length=128)
    type: str | None = None
    properties_json: dict | None = None
    required: list[str] | None = None
    status: str | None = None


class ViolationRecord(BaseModel):
    event: str = Field(..., max_length=128, description="被违规的事件名")
    issue: str = Field(..., max_length=256, description="问题描述")
    count: int = Field(1, ge=1, description="本次新增次数")
    source: str | None = Field(None, max_length=64)
    severity: str = Field("low", description="high | low")


class TransformationCreate(BaseModel):
    name: str = Field(..., max_length=128)
    scope: str | None = Field(None, max_length=128, description="作用范围：某事件或 all_events")
    type: str = Field("rename", description="rename | delete | mapping")
    config: dict | None = Field(None, description="规则配置")
    enabled: bool = True
    description: str | None = Field(None, max_length=512)


class TransformationUpdate(BaseModel):
    name: str | None = Field(None, max_length=128)
    scope: str | None = Field(None, max_length=128)
    type: str | None = None
    config: dict | None = None
    enabled: bool | None = None
    description: str | None = Field(None, max_length=512)


class ValidateRequest(BaseModel):
    """根据某计划的事件 schema 校验一条事件载荷；若不合规则记录违规。"""

    event: str = Field(..., max_length=128)
    properties: dict = Field(default_factory=dict)
    source: str | None = Field(None, max_length=64)
    record_violation: bool = Field(True, description="不合规时是否落库到 violations")


# ════════════════════════════════════════════════════════════════════════
# Service
# ════════════════════════════════════════════════════════════════════════


class ProtocolsService:
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

    # ---------- 埋点计划 tracking_plans ----------

    def create_plan(self, tenant_id: int, data: TrackingPlanCreate) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tracking_plans (tenant_id, name, description, sources, enabled)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    tenant_id, data.name, data.description,
                    json.dumps(data.sources or [], ensure_ascii=False),
                    1 if data.enabled else 0,
                ),
            )
            cur.execute("SELECT * FROM tracking_plans WHERE id = LAST_INSERT_ID()")
            return self._loads(cur.fetchone(), "sources")

    def list_plans(self, tenant_id: int) -> list[dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM tracking_plans WHERE tenant_id=%s ORDER BY id DESC",
                (tenant_id,),
            )
            return [self._loads(r, "sources") for r in cur.fetchall()]

    def get_plan(self, tenant_id: int, plan_id: int) -> dict | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM tracking_plans WHERE tenant_id=%s AND id=%s",
                (tenant_id, plan_id),
            )
            return self._loads(cur.fetchone(), "sources")

    def update_plan(self, tenant_id: int, plan_id: int, data: TrackingPlanUpdate) -> dict | None:
        fields, params = [], []
        if data.name is not None:
            fields.append("name=%s"); params.append(data.name)
        if data.description is not None:
            fields.append("description=%s"); params.append(data.description)
        if data.sources is not None:
            fields.append("sources=%s"); params.append(json.dumps(data.sources, ensure_ascii=False))
        if data.enabled is not None:
            fields.append("enabled=%s"); params.append(1 if data.enabled else 0)
        if not fields:
            return self.get_plan(tenant_id, plan_id)
        params.extend([tenant_id, plan_id])
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"UPDATE tracking_plans SET {', '.join(fields)} WHERE tenant_id=%s AND id=%s",
                params,
            )
        return self.get_plan(tenant_id, plan_id)

    def delete_plan(self, tenant_id: int, plan_id: int) -> bool:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM tracking_plan_events WHERE tenant_id=%s AND plan_id=%s",
                (tenant_id, plan_id),
            )
            cur.execute(
                "DELETE FROM tracking_plans WHERE tenant_id=%s AND id=%s",
                (tenant_id, plan_id),
            )
            return cur.rowcount > 0

    # ---------- 计划事件 tracking_plan_events ----------

    def list_events(self, tenant_id: int, plan_id: int) -> list[dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM tracking_plan_events
                WHERE tenant_id=%s AND plan_id=%s ORDER BY id
                """,
                (tenant_id, plan_id),
            )
            return [self._loads(r, "properties_json", "required") for r in cur.fetchall()]

    def create_event(self, tenant_id: int, plan_id: int, data: PlanEventCreate) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tracking_plan_events
                    (tenant_id, plan_id, event, type, properties_json, required, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    tenant_id, plan_id, data.event, data.type,
                    json.dumps(data.properties_json or {}, ensure_ascii=False),
                    json.dumps(data.required or [], ensure_ascii=False),
                    data.status,
                ),
            )
            cur.execute("SELECT * FROM tracking_plan_events WHERE id = LAST_INSERT_ID()")
            return self._loads(cur.fetchone(), "properties_json", "required")

    def get_event(self, tenant_id: int, event_id: int) -> dict | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM tracking_plan_events WHERE tenant_id=%s AND id=%s",
                (tenant_id, event_id),
            )
            return self._loads(cur.fetchone(), "properties_json", "required")

    def update_event(self, tenant_id: int, event_id: int, data: PlanEventUpdate) -> dict | None:
        fields, params = [], []
        if data.event is not None:
            fields.append("event=%s"); params.append(data.event)
        if data.type is not None:
            fields.append("type=%s"); params.append(data.type)
        if data.properties_json is not None:
            fields.append("properties_json=%s"); params.append(json.dumps(data.properties_json, ensure_ascii=False))
        if data.required is not None:
            fields.append("required=%s"); params.append(json.dumps(data.required, ensure_ascii=False))
        if data.status is not None:
            fields.append("status=%s"); params.append(data.status)
        if not fields:
            return self.get_event(tenant_id, event_id)
        params.extend([tenant_id, event_id])
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"UPDATE tracking_plan_events SET {', '.join(fields)} WHERE tenant_id=%s AND id=%s",
                params,
            )
        return self.get_event(tenant_id, event_id)

    def delete_event(self, tenant_id: int, event_id: int) -> bool:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM tracking_plan_events WHERE tenant_id=%s AND id=%s",
                (tenant_id, event_id),
            )
            return cur.rowcount > 0

    # ---------- 违规 violations ----------

    def list_violations(
        self,
        tenant_id: int,
        severity: str | None = None,
        source: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        limit = min(max(limit, 1), 500)
        sql = "SELECT * FROM violations WHERE tenant_id=%s"
        params: list = [tenant_id]
        if severity:
            sql += " AND severity=%s"; params.append(severity)
        if source:
            sql += " AND source=%s"; params.append(source)
        sql += " ORDER BY last_seen DESC LIMIT %s"
        params.append(limit)
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())

    def record_violation(self, tenant_id: int, data: ViolationRecord) -> dict:
        """按 (tenant_id, event, issue) 聚合：存在则累加 count，否则新建。"""
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO violations (tenant_id, event, issue, count, source, severity)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    count = count + VALUES(count),
                    source = VALUES(source),
                    severity = VALUES(severity),
                    last_seen = NOW()
                """,
                (tenant_id, data.event, data.issue, data.count, data.source, data.severity),
            )
            cur.execute(
                "SELECT * FROM violations WHERE tenant_id=%s AND event=%s AND issue=%s",
                (tenant_id, data.event, data.issue),
            )
            return cur.fetchone()

    def delete_violation(self, tenant_id: int, violation_id: int) -> bool:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM violations WHERE tenant_id=%s AND id=%s",
                (tenant_id, violation_id),
            )
            return cur.rowcount > 0

    # ---------- 转换规则 transformations ----------

    def create_transformation(self, tenant_id: int, data: TransformationCreate) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO transformations
                    (tenant_id, name, scope, type, config, enabled, description)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    tenant_id, data.name, data.scope, data.type,
                    json.dumps(data.config or {}, ensure_ascii=False),
                    1 if data.enabled else 0, data.description,
                ),
            )
            cur.execute("SELECT * FROM transformations WHERE id = LAST_INSERT_ID()")
            return self._loads(cur.fetchone(), "config")

    def list_transformations(self, tenant_id: int, scope: str | None = None) -> list[dict]:
        sql = "SELECT * FROM transformations WHERE tenant_id=%s"
        params: list = [tenant_id]
        if scope:
            sql += " AND scope=%s"; params.append(scope)
        sql += " ORDER BY id DESC"
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return [self._loads(r, "config") for r in cur.fetchall()]

    def get_transformation(self, tenant_id: int, tf_id: int) -> dict | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM transformations WHERE tenant_id=%s AND id=%s",
                (tenant_id, tf_id),
            )
            return self._loads(cur.fetchone(), "config")

    def update_transformation(self, tenant_id: int, tf_id: int, data: TransformationUpdate) -> dict | None:
        fields, params = [], []
        if data.name is not None:
            fields.append("name=%s"); params.append(data.name)
        if data.scope is not None:
            fields.append("scope=%s"); params.append(data.scope)
        if data.type is not None:
            fields.append("type=%s"); params.append(data.type)
        if data.config is not None:
            fields.append("config=%s"); params.append(json.dumps(data.config, ensure_ascii=False))
        if data.enabled is not None:
            fields.append("enabled=%s"); params.append(1 if data.enabled else 0)
        if data.description is not None:
            fields.append("description=%s"); params.append(data.description)
        if not fields:
            return self.get_transformation(tenant_id, tf_id)
        params.extend([tenant_id, tf_id])
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"UPDATE transformations SET {', '.join(fields)} WHERE tenant_id=%s AND id=%s",
                params,
            )
        return self.get_transformation(tenant_id, tf_id)

    def delete_transformation(self, tenant_id: int, tf_id: int) -> bool:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM transformations WHERE tenant_id=%s AND id=%s",
                (tenant_id, tf_id),
            )
            return cur.rowcount > 0

    # ---------- 校验：事件载荷 vs 计划 schema ----------

    def validate_event(self, tenant_id: int, plan_id: int, req: ValidateRequest) -> dict:
        """对照计划中该事件的 schema 校验载荷；不合规可落库 violations。"""
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM tracking_plan_events
                WHERE tenant_id=%s AND plan_id=%s AND event=%s
                """,
                (tenant_id, plan_id, req.event),
            )
            schema = self._loads(cur.fetchone(), "properties_json", "required")

        issues: list[str] = []
        if not schema:
            issues.append("事件未在埋点计划中定义（Unplanned Event）")
        else:
            required = schema.get("required") or []
            props_schema = schema.get("properties_json") or {}
            for field in required:
                if field not in req.properties:
                    issues.append(f"缺少必填属性: {field}")
            for field, value in req.properties.items():
                expected = props_schema.get(field)
                if expected and not self._type_ok(value, expected):
                    issues.append(f"属性 {field} 类型不符，应为 {expected}")

        valid = len(issues) == 0
        recorded = []
        if not valid and req.record_violation:
            for issue in issues:
                severity = "high" if issue.startswith("缺少必填") or "未在埋点计划" in issue else "low"
                recorded.append(
                    self.record_violation(
                        tenant_id,
                        ViolationRecord(
                            event=req.event, issue=issue, count=1,
                            source=req.source, severity=severity,
                        ),
                    )
                )
        return {"valid": valid, "event": req.event, "issues": issues, "recorded_violations": recorded}

    @staticmethod
    def _type_ok(value, expected: str) -> bool:
        expected = str(expected).lower()
        mapping = {
            "string": str, "str": str,
            "number": (int, float), "int": int, "integer": int, "float": float,
            "boolean": bool, "bool": bool,
            "array": list, "list": list,
            "object": dict, "dict": dict,
        }
        py = mapping.get(expected)
        if py is None:
            return True  # 未知类型不强校验
        # bool 是 int 的子类，需先排除
        if py is int and isinstance(value, bool):
            return False
        return isinstance(value, py)


# ════════════════════════════════════════════════════════════════════════
# Router
# ════════════════════════════════════════════════════════════════════════

router = APIRouter(prefix="/protocols", tags=["protocols"])
_service = ProtocolsService()


# ---- 埋点计划 ----

@router.get("/tracking-plans")
def api_list_plans(tenant_id: int = Query(...)):
    return _service.list_plans(tenant_id)


@router.post("/tracking-plans")
def api_create_plan(body: TrackingPlanCreate, tenant_id: int = Query(...)):
    return _service.create_plan(tenant_id, body)


@router.get("/tracking-plans/{plan_id}")
def api_get_plan(plan_id: int, tenant_id: int = Query(...)):
    row = _service.get_plan(tenant_id, plan_id)
    if not row:
        raise HTTPException(404, "埋点计划不存在")
    return row


@router.put("/tracking-plans/{plan_id}")
def api_update_plan(plan_id: int, body: TrackingPlanUpdate, tenant_id: int = Query(...)):
    if not _service.get_plan(tenant_id, plan_id):
        raise HTTPException(404, "埋点计划不存在")
    return _service.update_plan(tenant_id, plan_id, body)


@router.delete("/tracking-plans/{plan_id}")
def api_delete_plan(plan_id: int, tenant_id: int = Query(...)):
    if not _service.delete_plan(tenant_id, plan_id):
        raise HTTPException(404, "埋点计划不存在")
    return {"deleted": True, "id": plan_id}


# ---- 计划事件 ----

@router.get("/tracking-plans/{plan_id}/events")
def api_list_events(plan_id: int, tenant_id: int = Query(...)):
    return _service.list_events(tenant_id, plan_id)


@router.post("/tracking-plans/{plan_id}/events")
def api_create_event(plan_id: int, body: PlanEventCreate, tenant_id: int = Query(...)):
    if not _service.get_plan(tenant_id, plan_id):
        raise HTTPException(404, "埋点计划不存在")
    return _service.create_event(tenant_id, plan_id, body)


@router.put("/tracking-plans/events/{event_id}")
def api_update_event(event_id: int, body: PlanEventUpdate, tenant_id: int = Query(...)):
    if not _service.get_event(tenant_id, event_id):
        raise HTTPException(404, "事件不存在")
    return _service.update_event(tenant_id, event_id, body)


@router.delete("/tracking-plans/events/{event_id}")
def api_delete_event(event_id: int, tenant_id: int = Query(...)):
    if not _service.delete_event(tenant_id, event_id):
        raise HTTPException(404, "事件不存在")
    return {"deleted": True, "id": event_id}


@router.post("/tracking-plans/{plan_id}/validate")
def api_validate_event(plan_id: int, body: ValidateRequest, tenant_id: int = Query(...)):
    if not _service.get_plan(tenant_id, plan_id):
        raise HTTPException(404, "埋点计划不存在")
    return _service.validate_event(tenant_id, plan_id, body)


# ---- 违规 ----

@router.get("/violations")
def api_list_violations(
    tenant_id: int = Query(...),
    severity: str | None = Query(None),
    source: str | None = Query(None),
    limit: int = Query(100),
):
    return _service.list_violations(tenant_id, severity, source, limit)


@router.post("/violations")
def api_record_violation(body: ViolationRecord, tenant_id: int = Query(...)):
    return _service.record_violation(tenant_id, body)


@router.delete("/violations/{violation_id}")
def api_delete_violation(violation_id: int, tenant_id: int = Query(...)):
    if not _service.delete_violation(tenant_id, violation_id):
        raise HTTPException(404, "违规记录不存在")
    return {"deleted": True, "id": violation_id}


# ---- 转换规则 ----

@router.get("/transformations")
def api_list_transformations(tenant_id: int = Query(...), scope: str | None = Query(None)):
    return _service.list_transformations(tenant_id, scope)


@router.post("/transformations")
def api_create_transformation(body: TransformationCreate, tenant_id: int = Query(...)):
    return _service.create_transformation(tenant_id, body)


@router.get("/transformations/{tf_id}")
def api_get_transformation(tf_id: int, tenant_id: int = Query(...)):
    row = _service.get_transformation(tenant_id, tf_id)
    if not row:
        raise HTTPException(404, "转换规则不存在")
    return row


@router.put("/transformations/{tf_id}")
def api_update_transformation(tf_id: int, body: TransformationUpdate, tenant_id: int = Query(...)):
    if not _service.get_transformation(tenant_id, tf_id):
        raise HTTPException(404, "转换规则不存在")
    return _service.update_transformation(tenant_id, tf_id, body)


@router.delete("/transformations/{tf_id}")
def api_delete_transformation(tf_id: int, tenant_id: int = Query(...)):
    if not _service.delete_transformation(tenant_id, tf_id):
        raise HTTPException(404, "转换规则不存在")
    return {"deleted": True, "id": tf_id}
