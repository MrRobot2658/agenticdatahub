"""
00-platform 模块 — 租户管理 / 租户配置 / 配置审计

对标 Twilio Segment 的 Workspace 设置与管理后台。
- 租户 CRUD + 生命周期（停用/启用）
- 每租户配置存储（按域合并 tenant_config 各行，运行时热加载）
- 配置变更审计

风格对齐 groups.py / tags.py：复用 MysqlOlapExecutor 取连接，全部参数化 SQL，
所有读写按 tenant_id 隔离；本文件自带 APIRouter（变量名 router）与 Pydantic 模型，
不修改 main.py / schemas.py / 既有 service。
"""

import json
from contextlib import contextmanager
from typing import Any

import pymysql
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from executor import MysqlOlapExecutor

# ── 配置域常量（与 sql/migrate_modules.sql 中 config_domain 注释一致）─────────
CONFIG_DOMAINS = [
    "基础",
    "数据通道",
    "容量",
    "ID-Mapping",
    "存储",
    "隐私",
    "集成",
    "配额",
]


# ════════════════════════════════════════════════════════════════════════
# Pydantic 模型（仅本模块使用，刻意不写进 schemas.py）
# ════════════════════════════════════════════════════════════════════════

class TenantCreate(BaseModel):
    tenant_name: str = Field(..., description="租户名称")
    tier: str = Field("standard", description="premium / standard")
    scale_tier: str = Field("dev", description="dev / medium / large / xlarge")
    contact_email: str | None = Field(None, description="联系人邮箱")
    description: str | None = None
    actor: str | None = Field(None, description="操作者标识（预留鉴权）")


class TenantUpdate(BaseModel):
    tenant_name: str | None = None
    tier: str | None = None
    scale_tier: str | None = None
    contact_email: str | None = None
    description: str | None = None
    actor: str | None = None


class TenantStatusPatch(BaseModel):
    status: str = Field(..., description="active / suspended")
    reason: str | None = None
    actor: str | None = None


class TenantConfigUpdate(BaseModel):
    domain: str = Field(..., description="配置域：基础/数据通道/容量/ID-Mapping/存储/隐私/集成/配额")
    updates: dict[str, Any] = Field(..., description="{config_key: config_value} 键值对")
    reason: str | None = None
    actor: str | None = None


# ════════════════════════════════════════════════════════════════════════
# Service —— 复用 MysqlOlapExecutor 取连接，全部参数化 SQL
# ════════════════════════════════════════════════════════════════════════

class PlatformService:
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

    # ── 内部工具 ─────────────────────────────────────────────────────────
    @staticmethod
    def _events_24h_expr() -> str:
        # 以 merge_log（ID 合并操作）作为近 24h 事件量的真实代理
        return (
            "(SELECT COUNT(*) FROM merge_log ml "
            " WHERE ml.tenant_id = t.tenant_id "
            "   AND ml.created_at >= NOW() - INTERVAL 24 HOUR)"
        )

    def _audit(self, cur, tenant_id: int, actor: str | None, action: str,
               target: str, old_value: Any, new_value: Any, reason: str | None) -> None:
        cur.execute(
            """
            INSERT INTO tenant_audit
                (tenant_id, actor, action, target, old_value, new_value, reason)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                tenant_id,
                actor or "system",
                action,
                target,
                json.dumps(old_value, ensure_ascii=False) if old_value is not None else None,
                json.dumps(new_value, ensure_ascii=False) if new_value is not None else None,
                reason,
            ),
        )

    # ── 租户列表 / 详情 ──────────────────────────────────────────────────
    def list_tenants(self, search: str | None, tier: str | None,
                     status: str | None, limit: int, offset: int) -> dict:
        where = ["1=1"]
        params: list[Any] = []
        if search:
            where.append("(t.tenant_name LIKE %s OR CAST(t.tenant_id AS CHAR) LIKE %s)")
            like = f"%{search}%"
            params.extend([like, like])
        if tier:
            where.append("t.tier = %s")
            params.append(tier)
        if status:
            where.append("t.status = %s")
            params.append(status)
        clause = " AND ".join(where)

        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT COUNT(*) AS total FROM tenants t WHERE {clause}",
                    params,
                )
                total = int(cur.fetchone()["total"])

                cur.execute(
                    f"""
                    SELECT t.tenant_id, t.tenant_name, t.tier, t.status, t.scale_tier,
                           t.contact_email, t.created_at, t.updated_at,
                           {self._events_24h_expr()} AS events_count_24h
                    FROM tenants t
                    WHERE {clause}
                    ORDER BY t.tenant_id
                    LIMIT %s OFFSET %s
                    """,
                    [*params, limit, offset],
                )
                rows = list(cur.fetchall())
        return {"tenants": rows, "total": total}

    def get_tenant(self, tenant_id: int) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT t.tenant_id, t.tenant_name, t.tier, t.status, t.scale_tier,
                           t.contact_email, t.description, t.kafka_topic, t.created_at,
                           t.updated_at, {self._events_24h_expr()} AS events_24h
                    FROM tenants t
                    WHERE t.tenant_id = %s
                    """,
                    (tenant_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                cur.execute(
                    """
                    SELECT config_domain, COUNT(*) AS `keys`
                    FROM tenant_config WHERE tenant_id = %s
                    GROUP BY config_domain
                    """,
                    (tenant_id,),
                )
                summary = {r["config_domain"]: int(r["keys"]) for r in cur.fetchall()}
                row["config_summary"] = summary
                return row

    def create_tenant(self, data: TenantCreate) -> dict:
        with self._conn() as conn:
            with conn.cursor() as cur:
                # tenants.tenant_id 非自增，生成下一个 ID（≥1001）
                cur.execute("SELECT COALESCE(MAX(tenant_id), 1000) + 1 AS next_id FROM tenants")
                tenant_id = int(cur.fetchone()["next_id"])
                kafka_topic = f"tenant-{tenant_id}-events"

                cur.execute(
                    """
                    INSERT INTO tenants
                        (tenant_id, tenant_name, tier, kafka_topic, status,
                         scale_tier, contact_email, description)
                    VALUES (%s, %s, %s, %s, 'active', %s, %s, %s)
                    """,
                    (
                        tenant_id, data.tenant_name, data.tier, kafka_topic,
                        data.scale_tier, data.contact_email, data.description,
                    ),
                )
                # 初始化 OneID 序列
                cur.execute(
                    "INSERT IGNORE INTO one_id_sequence (tenant_id, next_id) VALUES (%s, 100000)",
                    (tenant_id,),
                )
                # 写入基础配置域（数据通道 topic / 容量档位）
                for domain, key, value in [
                    ("数据通道", "kafka_topic", kafka_topic),
                    ("容量", "scale_tier", data.scale_tier),
                ]:
                    cur.execute(
                        """
                        INSERT INTO tenant_config
                            (tenant_id, config_domain, config_key, config_value, updated_by)
                        VALUES (%s, %s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
                        """,
                        (tenant_id, domain, key, json.dumps(value, ensure_ascii=False),
                         data.actor or "system"),
                    )
                self._audit(cur, tenant_id, data.actor, "create", "tenant",
                            None, {"tenant_name": data.tenant_name, "scale_tier": data.scale_tier},
                            None)

                cur.execute(
                    "SELECT tenant_id, tenant_name, status, created_at FROM tenants WHERE tenant_id = %s",
                    (tenant_id,),
                )
                return cur.fetchone()

    def update_tenant(self, tenant_id: int, data: TenantUpdate) -> dict | None:
        fields = {
            "tenant_name": data.tenant_name,
            "tier": data.tier,
            "scale_tier": data.scale_tier,
            "contact_email": data.contact_email,
            "description": data.description,
        }
        sets = {k: v for k, v in fields.items() if v is not None}
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM tenants WHERE tenant_id = %s", (tenant_id,))
                old = cur.fetchone()
                if not old:
                    return None
                if sets:
                    assignments = ", ".join(f"{k} = %s" for k in sets)
                    cur.execute(
                        f"UPDATE tenants SET {assignments}, updated_at = NOW() WHERE tenant_id = %s",
                        [*sets.values(), tenant_id],
                    )
                    self._audit(cur, tenant_id, data.actor, "update", "tenant",
                                {k: old.get(k) for k in sets}, sets, None)
                cur.execute(
                    "SELECT tenant_id, updated_at FROM tenants WHERE tenant_id = %s",
                    (tenant_id,),
                )
                return cur.fetchone()

    def set_status(self, tenant_id: int, patch: TenantStatusPatch) -> dict | None:
        if patch.status not in ("active", "suspended"):
            raise ValueError("status 只能为 active / suspended")
        action = "resume" if patch.status == "active" else "suspend"
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT status FROM tenants WHERE tenant_id = %s", (tenant_id,))
                old = cur.fetchone()
                if not old:
                    return None
                cur.execute(
                    "UPDATE tenants SET status = %s, updated_at = NOW() WHERE tenant_id = %s",
                    (patch.status, tenant_id),
                )
                self._audit(cur, tenant_id, patch.actor, action, "status",
                            old["status"], patch.status, patch.reason)
                cur.execute(
                    "SELECT tenant_id, status, updated_at FROM tenants WHERE tenant_id = %s",
                    (tenant_id,),
                )
                return cur.fetchone()

    # ── 配置 ─────────────────────────────────────────────────────────────
    def get_config(self, tenant_id: int, domain: str | None) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM tenants WHERE tenant_id = %s", (tenant_id,))
                base = cur.fetchone()
                if not base:
                    return None

                where = ["tenant_id = %s"]
                params: list[Any] = [tenant_id]
                if domain:
                    where.append("config_domain = %s")
                    params.append(domain)
                cur.execute(
                    f"""
                    SELECT config_domain, config_key, config_value, updated_at, updated_by
                    FROM tenant_config WHERE {' AND '.join(where)}
                    ORDER BY config_domain, config_key
                    """,
                    params,
                )
                rows = cur.fetchall()

        result: dict[str, Any] = {"tenant_id": tenant_id}
        # 基础域恒从 tenants 主表派生
        if not domain or domain == "基础":
            result["基础"] = {
                "tenant_name": base.get("tenant_name"),
                "tier": base.get("tier"),
                "status": base.get("status"),
                "scale_tier": base.get("scale_tier"),
                "contact_email": base.get("contact_email"),
                "kafka_topic": base.get("kafka_topic"),
                "description": base.get("description"),
            }
        domains = [domain] if domain else CONFIG_DOMAINS
        for d in domains:
            if d == "基础":
                continue
            result.setdefault(d, {})
        for r in rows:
            d = r["config_domain"]
            result.setdefault(d, {})
            val = r["config_value"]
            if isinstance(val, str):
                try:
                    val = json.loads(val)
                except json.JSONDecodeError:
                    pass
            result[d][r["config_key"]] = val
        return result

    def update_config(self, tenant_id: int, body: TenantConfigUpdate) -> dict | None:
        if body.domain not in CONFIG_DOMAINS:
            raise ValueError(f"非法配置域: {body.domain}")
        if not body.updates:
            raise ValueError("updates 不能为空")

        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT tenant_id FROM tenants WHERE tenant_id = %s", (tenant_id,))
                if not cur.fetchone():
                    return None

                # dry-run 校验：数据通道 kafka_topic 不得与其它租户冲突
                if body.domain == "数据通道" and "kafka_topic" in body.updates:
                    topic = body.updates["kafka_topic"]
                    cur.execute(
                        "SELECT tenant_id FROM tenants WHERE kafka_topic = %s AND tenant_id <> %s",
                        (topic, tenant_id),
                    )
                    if cur.fetchone():
                        raise ValueError(f"kafka_topic 冲突: {topic} 已被其它租户占用")

                # 读旧值用于审计
                keys = list(body.updates.keys())
                placeholders = ",".join(["%s"] * len(keys))
                cur.execute(
                    f"""
                    SELECT config_key, config_value FROM tenant_config
                    WHERE tenant_id = %s AND config_domain = %s AND config_key IN ({placeholders})
                    """,
                    [tenant_id, body.domain, *keys],
                )
                old_map = {r["config_key"]: r["config_value"] for r in cur.fetchall()}

                for key, value in body.updates.items():
                    cur.execute(
                        """
                        INSERT INTO tenant_config
                            (tenant_id, config_domain, config_key, config_value, updated_by)
                        VALUES (%s, %s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE
                            config_value = VALUES(config_value),
                            updated_by = VALUES(updated_by)
                        """,
                        (tenant_id, body.domain, key, json.dumps(value, ensure_ascii=False),
                         body.actor or "system"),
                    )
                # 同步基础域到 tenants 主表（scale_tier 等）
                if body.domain == "容量" and "scale_tier" in body.updates:
                    cur.execute(
                        "UPDATE tenants SET scale_tier = %s, updated_at = NOW() WHERE tenant_id = %s",
                        (body.updates["scale_tier"], tenant_id),
                    )
                if body.domain == "数据通道" and "kafka_topic" in body.updates:
                    cur.execute(
                        "UPDATE tenants SET kafka_topic = %s, updated_at = NOW() WHERE tenant_id = %s",
                        (body.updates["kafka_topic"], tenant_id),
                    )

                self._audit(cur, tenant_id, body.actor, "update", body.domain,
                            old_map, body.updates, body.reason)
                cur.execute(
                    "SELECT NOW() AS updated_at",
                )
                updated_at = cur.fetchone()["updated_at"]
        return {
            "tenant_id": tenant_id,
            "domain": body.domain,
            "updated_keys": list(body.updates.keys()),
            "updated_at": updated_at,
        }

    # ── 审计 ─────────────────────────────────────────────────────────────
    def list_audit(self, tenant_id: int | None, actor: str | None,
                   action: str | None, limit: int, offset: int) -> dict:
        where = ["1=1"]
        params: list[Any] = []
        if tenant_id is not None:
            where.append("tenant_id = %s")
            params.append(tenant_id)
        if actor:
            where.append("actor = %s")
            params.append(actor)
        if action:
            where.append("action = %s")
            params.append(action)
        clause = " AND ".join(where)
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT COUNT(*) AS total FROM tenant_audit WHERE {clause}", params,
                )
                total = int(cur.fetchone()["total"])
                cur.execute(
                    f"""
                    SELECT audit_id, tenant_id, actor, action, target,
                           old_value, new_value, reason, created_at
                    FROM tenant_audit WHERE {clause}
                    ORDER BY audit_id DESC
                    LIMIT %s OFFSET %s
                    """,
                    [*params, limit, offset],
                )
                rows = []
                for r in cur.fetchall():
                    for k in ("old_value", "new_value"):
                        if isinstance(r.get(k), str):
                            try:
                                r[k] = json.loads(r[k])
                            except json.JSONDecodeError:
                                pass
                    rows.append(r)
        return {"audits": rows, "total": total}


# ════════════════════════════════════════════════════════════════════════
# Router
# ════════════════════════════════════════════════════════════════════════

router = APIRouter(prefix="/platform", tags=["平台管理"])
_service = PlatformService()


@router.get("/tenants", summary="租户列表（搜索/筛选）")
def list_tenants(
    search: str | None = None,
    tier: str | None = None,
    status: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return _service.list_tenants(search, tier, status, limit, offset)


@router.post("/tenants", summary="创建租户（建 topic + init OneID 序列 + 写配置）")
def create_tenant(body: TenantCreate):
    return _service.create_tenant(body)


@router.get("/tenants/{tenant_id}", summary="租户详情 + 配置统计")
def get_tenant(tenant_id: int):
    row = _service.get_tenant(tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="租户不存在")
    return row


@router.put("/tenants/{tenant_id}", summary="编辑租户基础信息")
def update_tenant(tenant_id: int, body: TenantUpdate):
    row = _service.update_tenant(tenant_id, body)
    if not row:
        raise HTTPException(status_code=404, detail="租户不存在")
    return row


@router.patch("/tenants/{tenant_id}", summary="停用/启用租户")
def patch_tenant_status(tenant_id: int, body: TenantStatusPatch):
    try:
        row = _service.set_status(tenant_id, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not row:
        raise HTTPException(status_code=404, detail="租户不存在")
    return row


@router.get("/tenants/{tenant_id}/config", summary="获取租户完整配置（按域合并）")
def get_tenant_config(tenant_id: int, domain: str | None = None):
    row = _service.get_config(tenant_id, domain)
    if not row:
        raise HTTPException(status_code=404, detail="租户不存在")
    return row


@router.put("/tenants/{tenant_id}/config", summary="更新租户配置（dry-run 校验 + 审计）")
def update_tenant_config(tenant_id: int, body: TenantConfigUpdate):
    try:
        row = _service.update_config(tenant_id, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not row:
        raise HTTPException(status_code=404, detail="租户不存在")
    return row


@router.get("/audit/tenant-config", summary="配置变更审计日志")
def list_tenant_config_audit(
    tenant_id: int | None = None,
    actor: str | None = None,
    action: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return _service.list_audit(tenant_id, actor, action, limit, offset)
