"""05 · engage — 触达模块后端

对标 Twilio Segment「Engage」：旅程（Journeys）+ 群发（Broadcasts）。
- 旅程：可视化多步骤自动化触达（trigger → steps → state 跟踪）。
- 群发：基于 Segment 群体的一次性批量触达 + 逐条回执。

设计约束（与项目铁律一致）：
- 所有表含 tenant_id，所有查询按 tenant_id 隔离。
- 全部参数化 SQL，绝不手拼；不改 main.py / schemas.py / 既有 service。
- 圈人/人数预估复用 dsl.DslEngine.estimate（其内部走 objects.ObjectService.build_sql）。
- service 在本文件内自行实例化，仅暴露 router（变量名 router）。
"""

import json
from contextlib import contextmanager
from typing import Any, Optional

import pymysql
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from dsl import DslEngine
from executor import MysqlOlapExecutor
from objects import ObjectError, ObjectService
from segments import SegmentService


# ════════════════════════════════════════════════════════════════════════
# Pydantic 模型（本文件内定义，不动 schemas.py）
# ════════════════════════════════════════════════════════════════════════

class JourneyCreate(BaseModel):
    tenant_id: int
    journey_code: str
    journey_name: Optional[str] = None
    description: Optional[str] = None
    trigger_type: Optional[str] = Field(None, description="segment_entry/event/schedule")
    trigger_condition: Optional[dict] = None
    base_segment_id: Optional[int] = None
    visual_config: Optional[dict] = None
    status: str = "draft"
    created_by: Optional[str] = None


class JourneyUpdate(BaseModel):
    journey_name: Optional[str] = None
    description: Optional[str] = None
    trigger_type: Optional[str] = None
    trigger_condition: Optional[dict] = None
    base_segment_id: Optional[int] = None
    visual_config: Optional[dict] = None
    status: Optional[str] = None


class JourneyStatusUpdate(BaseModel):
    status: str = Field(..., description="draft/active/paused/archived")


class JourneyStepInput(BaseModel):
    step_order: int = 0
    step_type: Optional[str] = Field(None, description="action/wait/split/exit")
    step_name: Optional[str] = None
    action_type: Optional[str] = None
    destination_id: Optional[str] = None
    wait_duration_hours: Optional[int] = None
    condition_logic: Optional[str] = Field(None, description="and/or")
    conditions: Optional[list] = None
    next_steps: Optional[list] = None


class JourneyStepsReplace(BaseModel):
    tenant_id: int
    steps: list[JourneyStepInput] = []


class BroadcastCreate(BaseModel):
    tenant_id: int
    broadcast_code: str
    broadcast_name: Optional[str] = None
    segment_id: Optional[int] = None
    destination_id: Optional[str] = None
    channel_type: Optional[str] = Field(None, description="email/sms/push/wechat")
    subject: Optional[str] = None
    content_template: Optional[str] = None
    estimated_size: int = 0
    scheduled_at: Optional[str] = None
    created_by: Optional[str] = None


class BroadcastUpdate(BaseModel):
    broadcast_name: Optional[str] = None
    segment_id: Optional[int] = None
    destination_id: Optional[str] = None
    channel_type: Optional[str] = None
    subject: Optional[str] = None
    content_template: Optional[str] = None
    estimated_size: Optional[int] = None
    scheduled_at: Optional[str] = None
    status: Optional[str] = None


class AudienceEstimateRequest(BaseModel):
    """复用 DSL 路径预估触达人数：可直接传 dsl，或传 segment_code 由系统取回 dsl。"""
    tenant_id: int
    segment_code: Optional[str] = None
    dsl: Optional[dict] = None


# ════════════════════════════════════════════════════════════════════════
# Service —— 仿 groups.py / segments.py 风格：MysqlOlapExecutor 取连接 + 参数化 SQL
# ════════════════════════════════════════════════════════════════════════

class EngageService:
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
    def _dumps(value: Any) -> Optional[str]:
        if value is None:
            return None
        return json.dumps(value, ensure_ascii=False)

    @staticmethod
    def _normalize(row: dict | None, json_fields: tuple[str, ...]) -> dict | None:
        if not row:
            return None
        for k in json_fields:
            if k in row and isinstance(row[k], str):
                try:
                    row[k] = json.loads(row[k])
                except json.JSONDecodeError:
                    pass
        return row

    # ── 旅程 Journeys ─────────────────────────────────────────────────────
    _JOURNEY_JSON = ("trigger_condition", "visual_config")

    def create_journey(self, data: dict) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO journeys
                    (tenant_id, journey_code, journey_name, description, trigger_type,
                     trigger_condition, base_segment_id, visual_config, status, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    data["tenant_id"], data["journey_code"], data.get("journey_name"),
                    data.get("description"), data.get("trigger_type"),
                    self._dumps(data.get("trigger_condition")), data.get("base_segment_id"),
                    self._dumps(data.get("visual_config")), data.get("status", "draft"),
                    data.get("created_by"),
                ),
            )
            cur.execute("SELECT * FROM journeys WHERE journey_id = LAST_INSERT_ID()")
            return self._normalize(cur.fetchone(), self._JOURNEY_JSON)

    def list_journeys(self, tenant_id: int, status: str | None = None) -> list[dict]:
        sql = "SELECT * FROM journeys WHERE tenant_id=%s"
        params: list[Any] = [tenant_id]
        if status:
            sql += " AND status=%s"
            params.append(status)
        sql += " ORDER BY journey_id DESC"
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return [self._normalize(r, self._JOURNEY_JSON) for r in cur.fetchall()]

    def get_journey(self, tenant_id: int, journey_id: int) -> dict | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM journeys WHERE tenant_id=%s AND journey_id=%s",
                (tenant_id, journey_id),
            )
            row = cur.fetchone()
            if not row:
                return None
            journey = self._normalize(row, self._JOURNEY_JSON)
            cur.execute(
                "SELECT * FROM journey_steps WHERE tenant_id=%s AND journey_id=%s "
                "ORDER BY step_order, step_id",
                (tenant_id, journey_id),
            )
            journey["steps"] = [
                self._normalize(r, ("conditions", "next_steps")) for r in cur.fetchall()
            ]
            return journey

    def update_journey(self, tenant_id: int, journey_id: int, data: dict) -> dict | None:
        fields: list[str] = []
        params: list[Any] = []
        column_map = {
            "journey_name": "journey_name", "description": "description",
            "trigger_type": "trigger_type", "base_segment_id": "base_segment_id",
            "status": "status",
        }
        for key, col in column_map.items():
            if data.get(key) is not None:
                fields.append(f"{col}=%s")
                params.append(data[key])
        for key in ("trigger_condition", "visual_config"):
            if data.get(key) is not None:
                fields.append(f"{key}=%s")
                params.append(self._dumps(data[key]))
        if not fields:
            return self.get_journey(tenant_id, journey_id)
        params.extend([tenant_id, journey_id])
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"UPDATE journeys SET {', '.join(fields)} WHERE tenant_id=%s AND journey_id=%s",
                params,
            )
        return self.get_journey(tenant_id, journey_id)

    def set_journey_status(self, tenant_id: int, journey_id: int, status: str) -> dict | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE journeys SET status=%s WHERE tenant_id=%s AND journey_id=%s",
                (status, tenant_id, journey_id),
            )
            if cur.rowcount == 0:
                # 可能状态未变化；确认旅程是否存在
                cur.execute(
                    "SELECT journey_id FROM journeys WHERE tenant_id=%s AND journey_id=%s",
                    (tenant_id, journey_id),
                )
                if not cur.fetchone():
                    return None
        return self.get_journey(tenant_id, journey_id)

    def delete_journey(self, tenant_id: int, journey_id: int) -> bool:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM journeys WHERE tenant_id=%s AND journey_id=%s",
                (tenant_id, journey_id),
            )
            deleted = cur.rowcount > 0
            if deleted:
                cur.execute(
                    "DELETE FROM journey_steps WHERE tenant_id=%s AND journey_id=%s",
                    (tenant_id, journey_id),
                )
                cur.execute(
                    "DELETE FROM journey_state WHERE tenant_id=%s AND journey_id=%s",
                    (tenant_id, journey_id),
                )
            return deleted

    # ── 旅程步骤 Journey Steps ─────────────────────────────────────────────
    def replace_steps(self, tenant_id: int, journey_id: int, steps: list[dict]) -> list[dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM journey_steps WHERE tenant_id=%s AND journey_id=%s",
                (tenant_id, journey_id),
            )
            for s in steps:
                cur.execute(
                    """
                    INSERT INTO journey_steps
                        (journey_id, tenant_id, step_order, step_type, step_name, action_type,
                         destination_id, wait_duration_hours, condition_logic, conditions, next_steps)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        journey_id, tenant_id, s.get("step_order", 0), s.get("step_type"),
                        s.get("step_name"), s.get("action_type"), s.get("destination_id"),
                        s.get("wait_duration_hours"), s.get("condition_logic"),
                        self._dumps(s.get("conditions")), self._dumps(s.get("next_steps")),
                    ),
                )
        return self.list_steps(tenant_id, journey_id)

    def list_steps(self, tenant_id: int, journey_id: int) -> list[dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM journey_steps WHERE tenant_id=%s AND journey_id=%s "
                "ORDER BY step_order, step_id",
                (tenant_id, journey_id),
            )
            return [self._normalize(r, ("conditions", "next_steps")) for r in cur.fetchall()]

    # ── 旅程运行状态 Journey State ─────────────────────────────────────────
    def list_journey_state(self, tenant_id: int, journey_id: int,
                           status: str | None = None, limit: int = 50) -> list[dict]:
        limit = min(max(limit, 1), 500)
        sql = "SELECT * FROM journey_state WHERE tenant_id=%s AND journey_id=%s"
        params: list[Any] = [tenant_id, journey_id]
        if status:
            sql += " AND status=%s"
            params.append(status)
        sql += " ORDER BY entered_at DESC LIMIT %s"
        params.append(limit)
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())

    def journey_stats(self, tenant_id: int, journey_id: int) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT status, COUNT(*) AS cnt
                FROM journey_state
                WHERE tenant_id=%s AND journey_id=%s
                GROUP BY status
                """,
                (tenant_id, journey_id),
            )
            by_status = {r["status"]: int(r["cnt"]) for r in cur.fetchall()}
        return {
            "journey_id": journey_id,
            "total": sum(by_status.values()),
            "active": by_status.get("active", 0),
            "completed": by_status.get("completed", 0),
            "exited": by_status.get("exited", 0),
            "by_status": by_status,
        }

    # ── 群发 Broadcasts ───────────────────────────────────────────────────
    def create_broadcast(self, data: dict) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO broadcasts
                    (tenant_id, broadcast_code, broadcast_name, segment_id, destination_id,
                     channel_type, subject, content_template, estimated_size, scheduled_at, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    data["tenant_id"], data["broadcast_code"], data.get("broadcast_name"),
                    data.get("segment_id"), data.get("destination_id"), data.get("channel_type"),
                    data.get("subject"), data.get("content_template"),
                    data.get("estimated_size", 0), data.get("scheduled_at"), data.get("created_by"),
                ),
            )
            cur.execute("SELECT * FROM broadcasts WHERE broadcast_id = LAST_INSERT_ID()")
            return cur.fetchone()

    def list_broadcasts(self, tenant_id: int, status: str | None = None) -> list[dict]:
        sql = "SELECT * FROM broadcasts WHERE tenant_id=%s"
        params: list[Any] = [tenant_id]
        if status:
            sql += " AND status=%s"
            params.append(status)
        sql += " ORDER BY broadcast_id DESC"
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())

    def get_broadcast(self, tenant_id: int, broadcast_id: int) -> dict | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM broadcasts WHERE tenant_id=%s AND broadcast_id=%s",
                (tenant_id, broadcast_id),
            )
            return cur.fetchone()

    def update_broadcast(self, tenant_id: int, broadcast_id: int, data: dict) -> dict | None:
        column_map = {
            "broadcast_name": "broadcast_name", "segment_id": "segment_id",
            "destination_id": "destination_id", "channel_type": "channel_type",
            "subject": "subject", "content_template": "content_template",
            "estimated_size": "estimated_size", "scheduled_at": "scheduled_at",
            "status": "status",
        }
        fields: list[str] = []
        params: list[Any] = []
        for key, col in column_map.items():
            if data.get(key) is not None:
                fields.append(f"{col}=%s")
                params.append(data[key])
        if not fields:
            return self.get_broadcast(tenant_id, broadcast_id)
        params.extend([tenant_id, broadcast_id])
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"UPDATE broadcasts SET {', '.join(fields)} WHERE tenant_id=%s AND broadcast_id=%s",
                params,
            )
        return self.get_broadcast(tenant_id, broadcast_id)

    def delete_broadcast(self, tenant_id: int, broadcast_id: int) -> bool:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM broadcasts WHERE tenant_id=%s AND broadcast_id=%s",
                (tenant_id, broadcast_id),
            )
            deleted = cur.rowcount > 0
            if deleted:
                cur.execute(
                    "DELETE FROM broadcast_sends WHERE tenant_id=%s AND broadcast_id=%s",
                    (tenant_id, broadcast_id),
                )
            return deleted

    def mark_broadcast_sending(self, tenant_id: int, broadcast_id: int) -> dict | None:
        """将群发标记为发送中并记录发送时间（开发模拟，不真正外呼第三方）。"""
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE broadcasts SET status='sending', sent_at=NOW() "
                "WHERE tenant_id=%s AND broadcast_id=%s",
                (tenant_id, broadcast_id),
            )
            cur.execute(
                "SELECT broadcast_id FROM broadcasts WHERE tenant_id=%s AND broadcast_id=%s",
                (tenant_id, broadcast_id),
            )
            if not cur.fetchone():
                return None
        return self.get_broadcast(tenant_id, broadcast_id)

    def list_sends(self, tenant_id: int, broadcast_id: int,
                   status: str | None = None, limit: int = 100) -> list[dict]:
        limit = min(max(limit, 1), 500)
        sql = "SELECT * FROM broadcast_sends WHERE tenant_id=%s AND broadcast_id=%s"
        params: list[Any] = [tenant_id, broadcast_id]
        if status:
            sql += " AND status=%s"
            params.append(status)
        sql += " ORDER BY send_id DESC LIMIT %s"
        params.append(limit)
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())

    def broadcast_stats(self, tenant_id: int, broadcast_id: int) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    COUNT(*)                                              AS total,
                    SUM(status='sent')                                    AS sent,
                    SUM(status='delivered')                               AS delivered,
                    SUM(status='bounced')                                 AS bounced,
                    SUM(status='opened')                                  AS opened,
                    SUM(status='clicked')                                 AS clicked,
                    SUM(opened_at IS NOT NULL)                            AS opened_any,
                    SUM(clicked_at IS NOT NULL)                           AS clicked_any
                FROM broadcast_sends
                WHERE tenant_id=%s AND broadcast_id=%s
                """,
                (tenant_id, broadcast_id),
            )
            row = cur.fetchone() or {}
        return {k: int(v or 0) for k, v in row.items()}


# ════════════════════════════════════════════════════════════════════════
# Router
# ════════════════════════════════════════════════════════════════════════

router = APIRouter(prefix="/engage", tags=["engage"])

_engage_service = EngageService()
_segment_service = SegmentService()
_dsl_engine = DslEngine(ObjectService())


# ── 旅程 Journeys ─────────────────────────────────────────────────────────
@router.get("/journeys")
def list_journeys(tenant_id: int = Query(...), status: str | None = None):
    return _engage_service.list_journeys(tenant_id, status)


@router.post("/journeys")
def create_journey(body: JourneyCreate):
    try:
        return _engage_service.create_journey(body.model_dump())
    except pymysql.err.IntegrityError:
        raise HTTPException(status_code=409, detail="journey_code 已存在")


@router.get("/journeys/{journey_id}")
def get_journey(journey_id: int, tenant_id: int = Query(...)):
    row = _engage_service.get_journey(tenant_id, journey_id)
    if not row:
        raise HTTPException(status_code=404, detail="旅程不存在")
    return row


@router.put("/journeys/{journey_id}")
def update_journey(journey_id: int, body: JourneyUpdate, tenant_id: int = Query(...)):
    row = _engage_service.update_journey(tenant_id, journey_id, body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(status_code=404, detail="旅程不存在")
    return row


@router.post("/journeys/{journey_id}/status")
def set_journey_status(journey_id: int, body: JourneyStatusUpdate, tenant_id: int = Query(...)):
    row = _engage_service.set_journey_status(tenant_id, journey_id, body.status)
    if not row:
        raise HTTPException(status_code=404, detail="旅程不存在")
    return row


@router.delete("/journeys/{journey_id}")
def delete_journey(journey_id: int, tenant_id: int = Query(...)):
    if not _engage_service.delete_journey(tenant_id, journey_id):
        raise HTTPException(status_code=404, detail="旅程不存在")
    return {"deleted": True, "journey_id": journey_id}


@router.get("/journeys/{journey_id}/steps")
def list_steps(journey_id: int, tenant_id: int = Query(...)):
    return _engage_service.list_steps(tenant_id, journey_id)


@router.put("/journeys/{journey_id}/steps")
def replace_steps(journey_id: int, body: JourneyStepsReplace):
    if not _engage_service.get_journey(body.tenant_id, journey_id):
        raise HTTPException(status_code=404, detail="旅程不存在")
    steps = [s.model_dump() for s in body.steps]
    return _engage_service.replace_steps(body.tenant_id, journey_id, steps)


@router.get("/journeys/{journey_id}/state")
def list_journey_state(journey_id: int, tenant_id: int = Query(...),
                       status: str | None = None, limit: int = 50):
    return _engage_service.list_journey_state(tenant_id, journey_id, status, limit)


@router.get("/journeys/{journey_id}/stats")
def journey_stats(journey_id: int, tenant_id: int = Query(...)):
    return _engage_service.journey_stats(tenant_id, journey_id)


# ── 群发 Broadcasts ───────────────────────────────────────────────────────
@router.get("/broadcasts")
def list_broadcasts(tenant_id: int = Query(...), status: str | None = None):
    return _engage_service.list_broadcasts(tenant_id, status)


@router.post("/broadcasts")
def create_broadcast(body: BroadcastCreate):
    try:
        return _engage_service.create_broadcast(body.model_dump())
    except pymysql.err.IntegrityError:
        raise HTTPException(status_code=409, detail="broadcast_code 已存在")


@router.get("/broadcasts/{broadcast_id}")
def get_broadcast(broadcast_id: int, tenant_id: int = Query(...)):
    row = _engage_service.get_broadcast(tenant_id, broadcast_id)
    if not row:
        raise HTTPException(status_code=404, detail="群发任务不存在")
    return row


@router.put("/broadcasts/{broadcast_id}")
def update_broadcast(broadcast_id: int, body: BroadcastUpdate, tenant_id: int = Query(...)):
    row = _engage_service.update_broadcast(tenant_id, broadcast_id, body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(status_code=404, detail="群发任务不存在")
    return row


@router.delete("/broadcasts/{broadcast_id}")
def delete_broadcast(broadcast_id: int, tenant_id: int = Query(...)):
    if not _engage_service.delete_broadcast(tenant_id, broadcast_id):
        raise HTTPException(status_code=404, detail="群发任务不存在")
    return {"deleted": True, "broadcast_id": broadcast_id}


@router.post("/broadcasts/{broadcast_id}/send")
def send_broadcast(broadcast_id: int, tenant_id: int = Query(...)):
    row = _engage_service.mark_broadcast_sending(tenant_id, broadcast_id)
    if not row:
        raise HTTPException(status_code=404, detail="群发任务不存在")
    return row


@router.get("/broadcasts/{broadcast_id}/sends")
def list_sends(broadcast_id: int, tenant_id: int = Query(...),
               status: str | None = None, limit: int = 100):
    return _engage_service.list_sends(tenant_id, broadcast_id, status, limit)


@router.get("/broadcasts/{broadcast_id}/stats")
def broadcast_stats(broadcast_id: int, tenant_id: int = Query(...)):
    return _engage_service.broadcast_stats(tenant_id, broadcast_id)


# ── 触达人数预估（复用 DSL → objects.build_sql，绝不手拼/直出 SQL）────────────
@router.post("/estimate-audience")
def estimate_audience(body: AudienceEstimateRequest):
    dsl = body.dsl
    if dsl is None and body.segment_code:
        seg = _segment_service.get(body.tenant_id, body.segment_code)
        if not seg:
            raise HTTPException(status_code=404, detail="Segment 不存在")
        dsl = seg.get("dsl")
    if not dsl:
        raise HTTPException(status_code=400, detail="缺少 dsl 或 segment_code")
    rule = {**dsl, "tenant_id": body.tenant_id}
    try:
        return _dsl_engine.estimate(rule)
    except ObjectError as e:
        raise HTTPException(status_code=400, detail=str(e))
