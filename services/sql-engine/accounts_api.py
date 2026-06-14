"""04 · accounts —— 账户（B2B Account 对象）后端模块

只做加法：不修改 main.py / schemas.py / 既有 service。
- 账户列表 / 详情复用 objects.py 的 ObjectService（对象注册表 + 参数化 build_sql 路径），绝不手拼业务 SQL。
- 账户级聚合指标 / 父子层级 / 合并日志 直接读写 account_aggregates / account_hierarchy /
  account_merge_log（迁移已建表），全部参数化、全部带 tenant_id 隔离。

挂载方式（main.py）：
    from accounts_api import router as accounts_router
    app.include_router(accounts_router)
"""

import json
from contextlib import contextmanager
from typing import Any

import pymysql
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from executor import MysqlOlapExecutor
from objects import ObjectError, ObjectService


# ════════════════════════════════════════════════════════════════════════
# Pydantic 模型（本文件内定义，不动 schemas.py）
# ════════════════════════════════════════════════════════════════════════
class AccountCondition(BaseModel):
    field: str
    op: str = "eq"
    value: Any = None


class AggregateUpsert(BaseModel):
    user_count: int = 0
    active_user_count: int = 0
    total_gmv: float = 0
    purchase_count: int = 0
    product_count: int = 0
    channel_count: int = 0
    tags: list[str] | None = None
    properties: dict[str, Any] | None = None
    metric_date: str | None = Field(None, description="YYYY-MM-DD")


class HierarchyUpsert(BaseModel):
    parent_account_id: str | None = None
    level: int = 1
    path: str | None = None
    relationship_type: str | None = Field(None, description="group/subsidiary/affiliate")
    properties: dict[str, Any] | None = None


class MergeRequest(BaseModel):
    master_account_id: str = Field(..., description="合并后目标账户")
    merged_account_id: str = Field(..., description="被合并源账户")
    action: str = "merge"  # merge / dedup / unmerge
    merged_fields: dict[str, Any] | None = None
    user_count: int | None = None
    created_by: str | None = None


# ════════════════════════════════════════════════════════════════════════
# Service —— 仿 groups.py / tags.py 风格
# ════════════════════════════════════════════════════════════════════════
class AccountService:
    def __init__(self, executor: MysqlOlapExecutor | None = None):
        self._executor = executor or MysqlOlapExecutor()
        self.config = self._executor.config
        # 复用对象服务做账户筛选/圈人（共用同一 executor，避免重复连接配置）
        self.objects = ObjectService(self._executor)

    @contextmanager
    def _conn(self):
        conn = pymysql.connect(**self.config, autocommit=True)
        try:
            yield conn
        finally:
            conn.close()

    # ── 账户列表 / 详情（复用 ObjectService.build_sql 参数化路径）───────────
    def list_accounts(self, tenant_id: int, conditions: list[dict] | None,
                      limit: int = 50) -> dict:
        return self.objects.search(tenant_id, "account", conditions, None, limit=limit)

    def get_account(self, tenant_id: int, account_id: str) -> dict | None:
        res = self.objects.search(
            tenant_id, "account",
            [{"field": "account_id", "op": "eq", "value": account_id}],
            None, limit=1,
        )
        data = res.get("data") or []
        return data[0] if data else None

    def list_account_users(self, tenant_id: int, account_id: str, limit: int = 200) -> dict:
        """账户下的用户：user --owns--> account(account_id=?)，走对象关系 JOIN（≤3 跳校验）。"""
        return self.objects.search(
            tenant_id, "user", None,
            [{
                "rel_type": "owns", "object": "account", "direction": "forward",
                "conditions": [{"field": "account_id", "op": "eq", "value": account_id}],
            }],
            limit=limit,
        )

    # ── 账户聚合指标 account_aggregates ────────────────────────────────────
    def get_aggregates(self, tenant_id: int, account_id: str) -> dict | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM account_aggregates WHERE tenant_id=%s AND account_id=%s",
                (tenant_id, account_id),
            )
            return self._normalize(cur.fetchone())

    def upsert_aggregates(self, tenant_id: int, account_id: str, data: AggregateUpsert) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO account_aggregates
                    (tenant_id, account_id, user_count, active_user_count, total_gmv,
                     purchase_count, product_count, channel_count, tags, properties,
                     last_update_time, metric_date)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
                ON DUPLICATE KEY UPDATE
                    user_count=VALUES(user_count), active_user_count=VALUES(active_user_count),
                    total_gmv=VALUES(total_gmv), purchase_count=VALUES(purchase_count),
                    product_count=VALUES(product_count), channel_count=VALUES(channel_count),
                    tags=VALUES(tags), properties=VALUES(properties),
                    last_update_time=NOW(), metric_date=VALUES(metric_date)
                """,
                (
                    tenant_id, account_id, data.user_count, data.active_user_count,
                    data.total_gmv, data.purchase_count, data.product_count, data.channel_count,
                    json.dumps(data.tags or [], ensure_ascii=False),
                    json.dumps(data.properties or {}, ensure_ascii=False),
                    data.metric_date,
                ),
            )
            cur.execute(
                "SELECT * FROM account_aggregates WHERE tenant_id=%s AND account_id=%s",
                (tenant_id, account_id),
            )
            return self._normalize(cur.fetchone())

    # ── 账户层级 account_hierarchy ─────────────────────────────────────────
    def get_hierarchy(self, tenant_id: int, account_id: str) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM account_hierarchy WHERE tenant_id=%s AND account_id=%s",
                (tenant_id, account_id),
            )
            node = self._normalize(cur.fetchone())
            cur.execute(
                "SELECT * FROM account_hierarchy WHERE tenant_id=%s AND parent_account_id=%s "
                "ORDER BY account_id",
                (tenant_id, account_id),
            )
            children = [self._normalize(r) for r in cur.fetchall()]
        return {"node": node, "children": children}

    def upsert_hierarchy(self, tenant_id: int, account_id: str, data: HierarchyUpsert) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO account_hierarchy
                    (tenant_id, account_id, parent_account_id, level, path,
                     relationship_type, properties)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    parent_account_id=VALUES(parent_account_id), level=VALUES(level),
                    path=VALUES(path), relationship_type=VALUES(relationship_type),
                    properties=VALUES(properties)
                """,
                (
                    tenant_id, account_id, data.parent_account_id, data.level, data.path,
                    data.relationship_type,
                    json.dumps(data.properties or {}, ensure_ascii=False),
                ),
            )
            cur.execute(
                "SELECT * FROM account_hierarchy WHERE tenant_id=%s AND account_id=%s",
                (tenant_id, account_id),
            )
            return self._normalize(cur.fetchone())

    # ── 账户合并日志 account_merge_log ─────────────────────────────────────
    def list_merge_log(self, tenant_id: int, account_id: str | None = None,
                       limit: int = 100) -> list[dict]:
        limit = min(max(int(limit), 1), 500)
        with self._conn() as conn, conn.cursor() as cur:
            if account_id:
                cur.execute(
                    "SELECT * FROM account_merge_log WHERE tenant_id=%s "
                    "AND (master_account_id=%s OR merged_account_id=%s) "
                    "ORDER BY created_at DESC LIMIT %s",
                    (tenant_id, account_id, account_id, limit),
                )
            else:
                cur.execute(
                    "SELECT * FROM account_merge_log WHERE tenant_id=%s "
                    "ORDER BY created_at DESC LIMIT %s",
                    (tenant_id, limit),
                )
            return [self._normalize(r) for r in cur.fetchall()]

    def merge(self, tenant_id: int, data: MergeRequest) -> dict:
        if data.master_account_id == data.merged_account_id:
            raise ValueError("master 与 merged 账户不能相同")
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO account_merge_log
                    (tenant_id, master_account_id, merged_account_id, action,
                     merged_fields, user_count, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    action=VALUES(action), merged_fields=VALUES(merged_fields),
                    user_count=VALUES(user_count), created_by=VALUES(created_by),
                    created_at=NOW()
                """,
                (
                    tenant_id, data.master_account_id, data.merged_account_id, data.action,
                    json.dumps(data.merged_fields or {}, ensure_ascii=False),
                    data.user_count, data.created_by,
                ),
            )
            cur.execute(
                "SELECT * FROM account_merge_log WHERE tenant_id=%s "
                "AND master_account_id=%s AND merged_account_id=%s",
                (tenant_id, data.master_account_id, data.merged_account_id),
            )
            return self._normalize(cur.fetchone())

    def _normalize(self, row: dict | None) -> dict | None:
        if not row:
            return None
        for k in ("tags", "properties", "merged_fields"):
            if k in row and isinstance(row[k], str):
                try:
                    row[k] = json.loads(row[k])
                except (json.JSONDecodeError, TypeError):
                    pass
        return row


# ════════════════════════════════════════════════════════════════════════
# Router
# ════════════════════════════════════════════════════════════════════════
router = APIRouter(prefix="/accounts", tags=["accounts"])
_service = AccountService()


@router.get("")
def list_accounts(tenant_id: int = Query(...), limit: int = Query(50, ge=1, le=1000)):
    """账户列表（复用对象筛选路径）。"""
    try:
        return _service.list_accounts(tenant_id, None, limit)
    except ObjectError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/search")
def search_accounts(
    conditions: list[AccountCondition],
    tenant_id: int = Query(...),
    limit: int = Query(50, ge=1, le=1000),
):
    """按条件筛选账户（条件经对象注册表字段/操作符白名单校验后参数化编译）。"""
    try:
        return _service.list_accounts(
            tenant_id, [c.model_dump() for c in conditions], limit
        )
    except ObjectError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{account_id}")
def get_account(account_id: str, tenant_id: int = Query(...)):
    """账户详情 + 聚合指标 + 层级。"""
    acct = _service.get_account(tenant_id, account_id)
    if not acct:
        raise HTTPException(status_code=404, detail="账户不存在")
    return {
        "account": acct,
        "aggregates": _service.get_aggregates(tenant_id, account_id),
        "hierarchy": _service.get_hierarchy(tenant_id, account_id),
    }


@router.get("/{account_id}/users")
def list_account_users(
    account_id: str, tenant_id: int = Query(...), limit: int = Query(200, ge=1, le=1000)
):
    """账户下的用户（user --owns--> account）。"""
    try:
        return _service.list_account_users(tenant_id, account_id, limit)
    except ObjectError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{account_id}/aggregates")
def get_aggregates(account_id: str, tenant_id: int = Query(...)):
    return _service.get_aggregates(tenant_id, account_id) or {}


@router.put("/{account_id}/aggregates")
def upsert_aggregates(
    account_id: str, body: AggregateUpsert, tenant_id: int = Query(...)
):
    return _service.upsert_aggregates(tenant_id, account_id, body)


@router.get("/{account_id}/hierarchy")
def get_hierarchy(account_id: str, tenant_id: int = Query(...)):
    return _service.get_hierarchy(tenant_id, account_id)


@router.put("/{account_id}/hierarchy")
def upsert_hierarchy(
    account_id: str, body: HierarchyUpsert, tenant_id: int = Query(...)
):
    return _service.upsert_hierarchy(tenant_id, account_id, body)


@router.get("/{account_id}/merge-log")
def list_account_merge_log(
    account_id: str, tenant_id: int = Query(...), limit: int = Query(100, ge=1, le=500)
):
    return _service.list_merge_log(tenant_id, account_id, limit)


@router.get("/-/merge-log")
def list_all_merge_log(tenant_id: int = Query(...), limit: int = Query(100, ge=1, le=500)):
    """租户全量账户合并日志。"""
    return _service.list_merge_log(tenant_id, None, limit)


@router.post("/merge")
def merge_accounts(body: MergeRequest, tenant_id: int = Query(...)):
    """记录账户合并（写 account_merge_log）。"""
    try:
        return _service.merge(tenant_id, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
