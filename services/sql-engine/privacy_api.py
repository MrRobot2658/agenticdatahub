"""
07 · privacy 模块 —— 隐私合规后端

对标 Twilio Segment 的 Privacy Portal：
  - PII 字段扫描与管控规则（pii_rules）
  - 同意分类与主体级同意记录（consent_categories / consent_records）
  - GDPR 删除/抑制工单与执行回执（deletion_requests / suppression_list）
  - 隐私操作审计（privacy_audit_log）

约定（与既有 service 一致）：
  - 全部走 MysqlOlapExecutor 取连接，参数化 SQL，绝不手拼。
  - 所有表含 tenant_id，所有查询按 tenant_id 隔离。
  - 圈人/对象筛选复用 objects.ObjectService（本文件内自行实例化，不改 main.py）。

本文件对外暴露 `router`（FastAPI APIRouter，prefix=/privacy）。
"""

import json
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Literal

import pymysql
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from executor import MysqlOlapExecutor
from objects import OBJECT_REGISTRY, ObjectService


# ════════════════════════════════════════════════════════════════════════
# PII 关键词词典 —— 字段名启发式匹配（仅用于建议，不改动任何真实数据）
# ════════════════════════════════════════════════════════════════════════

PII_DICTIONARY: dict[str, dict] = {
    "phone":          {"category": "电话号码",   "confidence": 0.98, "action": "hash"},
    "mobile":         {"category": "电话号码",   "confidence": 0.95, "action": "hash"},
    "tel":            {"category": "电话号码",   "confidence": 0.85, "action": "hash"},
    "email":          {"category": "电子邮箱",   "confidence": 0.97, "action": "hash"},
    "mail":           {"category": "电子邮箱",   "confidence": 0.80, "action": "hash"},
    "id_card":        {"category": "身份证号",   "confidence": 0.98, "action": "block"},
    "idcard":         {"category": "身份证号",   "confidence": 0.98, "action": "block"},
    "id_number":      {"category": "身份证号",   "confidence": 0.90, "action": "block"},
    "name":           {"category": "姓名",       "confidence": 0.70, "action": "hash"},
    "real_name":      {"category": "姓名",       "confidence": 0.92, "action": "hash"},
    "address":        {"category": "地址",       "confidence": 0.85, "action": "hash"},
    "addr":           {"category": "地址",       "confidence": 0.75, "action": "hash"},
    "wechat_openid":  {"category": "渠道标识",   "confidence": 0.90, "action": "hash"},
    "wechat_unionid": {"category": "渠道标识",   "confidence": 0.90, "action": "hash"},
    "wework_extid":   {"category": "渠道标识",   "confidence": 0.88, "action": "hash"},
    "device":         {"category": "设备标识",   "confidence": 0.85, "action": "hash"},
    "imei":           {"category": "设备标识",   "confidence": 0.95, "action": "hash"},
    "oaid":           {"category": "设备标识",   "confidence": 0.95, "action": "hash"},
    "ip":             {"category": "网络标识",   "confidence": 0.80, "action": "hash"},
    "birthday":       {"category": "生日",       "confidence": 0.85, "action": "hash"},
    "gender":         {"category": "敏感人口属性", "confidence": 0.60, "action": "allow"},
}

# user 对象在宽表 doris_user_wide 上的身份列（OBJECT_REGISTRY 未完整登记，补充扫描）
_USER_IDENTITY_COLUMNS = [
    "wechat_openid", "wechat_unionid", "wework_extid", "phone", "email", "device", "form_id",
]

# 执行删除时涉及的物理表（表名为内部常量，绝不来自用户输入；值全部参数化）
_DELETE_TARGETS = [
    {"table": "id_mapping",       "where": "tenant_id=%s AND one_id=%s"},
    {"table": "doris_id_mapping", "where": "tenant_id=%s AND one_id=%s"},
    {"table": "doris_user_wide",  "where": "tenant_id=%s AND one_id=%s"},
    {"table": "user_group_members", "where": "tenant_id=%s AND one_id=%s"},
    {
        "table": "object_relations",
        "where": "tenant_id=%s AND ((src_type='user' AND src_id=%s) OR (dst_type='user' AND dst_id=%s))",
        "extra_one_id": True,
    },
]


def _match_pii(field_name: str) -> dict | None:
    low = field_name.lower()
    best = None
    for kw, meta in PII_DICTIONARY.items():
        if kw in low:
            if best is None or meta["confidence"] > best["confidence"]:
                best = meta
    return best


# ════════════════════════════════════════════════════════════════════════
# Pydantic 模型
# ════════════════════════════════════════════════════════════════════════

class PiiScanRequest(BaseModel):
    tenant_id: int
    scan_depth: Literal["all", "object", "source"] = "all"
    object_type: str | None = Field(default=None, description="scan_depth=object 时指定对象")
    source: str | None = Field(default=None, description="scan_depth=source 时指定数据源")
    limit: int = 200


class PiiRuleCreate(BaseModel):
    tenant_id: int
    field_name: str
    category: str | None = None
    action: Literal["hash", "block", "allow", "mask", "drop", "encrypt"] = "hash"
    scope: str | None = None
    source: str | None = None
    target_objects: list[str] | None = None
    created_by: str | None = None


class PiiRuleUpdate(BaseModel):
    action: str | None = None
    scope: str | None = None
    category: str | None = None
    target_objects: list[str] | None = None
    is_active: int | None = None


class ConsentCategoryCreate(BaseModel):
    tenant_id: int
    category_name: str
    description: str | None = None
    is_required: bool = False
    vendor_list: list[str] | None = None
    created_by: str | None = None


class ConsentCategoryUpdate(BaseModel):
    category_name: str | None = None
    description: str | None = None
    is_required: bool | None = None
    vendor_list: list[str] | None = None


class ConsentRecordCreate(BaseModel):
    tenant_id: int
    one_id: int | None = None
    identifier: str | None = None
    category_id: int
    granted: bool


class DeletionRequestCreate(BaseModel):
    tenant_id: int
    identifier: str | None = None
    one_id: int | None = None
    request_type: Literal["delete", "suppress", "both"] = "delete"
    reason: str | None = None
    created_by: str | None = None


class DeletionExecuteRequest(BaseModel):
    confirm: bool = False


class AuditLogQuery(BaseModel):
    tenant_id: int
    operation_type: str | None = None
    request_id: int | None = None
    start_date: str | None = None
    end_date: str | None = None
    limit: int = 50
    offset: int = 0


# ════════════════════════════════════════════════════════════════════════
# Service
# ════════════════════════════════════════════════════════════════════════

class PrivacyService:
    def __init__(self, executor: MysqlOlapExecutor | None = None):
        self._executor = executor or MysqlOlapExecutor()
        self.config = self._executor.config
        self.objects = ObjectService(self._executor)

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

    # ── PII 扫描 ──────────────────────────────────────────────────────────
    def pii_scan(self, req: PiiScanRequest) -> dict:
        # 收集待扫描的 (object_type, field) 候选，来源是 OBJECT_REGISTRY（单一事实源）
        candidates: list[tuple[str, str]] = []
        objects = OBJECT_REGISTRY.items()
        if req.scan_depth == "object" and req.object_type:
            objects = [(req.object_type, OBJECT_REGISTRY[req.object_type])] \
                if req.object_type in OBJECT_REGISTRY else []
        for otype, meta in objects:
            for fld in meta["fields"]:
                candidates.append((otype, fld))
            if otype == "user":
                for col in _USER_IDENTITY_COLUMNS:
                    candidates.append((otype, col))

        # 已有规则：用于标注 suggested_action（已管控/建议管控）
        existing = {
            r["field_name"]: r
            for r in self.list_pii_rules(req.tenant_id, None)
        }

        detected: list[dict] = []
        seen: set[tuple[str, str]] = set()
        for otype, fld in candidates:
            if (otype, fld) in seen:
                continue
            seen.add((otype, fld))
            hit = _match_pii(fld)
            if not hit:
                continue
            rule = existing.get(fld)
            detected.append({
                "object": otype,
                "field": fld,
                "category": hit["category"],
                "confidence": hit["confidence"],
                "suggested_action": hit["action"],
                "already_governed": bool(rule and rule.get("is_active")),
                "existing_rule_id": rule["rule_id"] if rule else None,
            })
        detected.sort(key=lambda d: d["confidence"], reverse=True)
        return {
            "tenant_id": req.tenant_id,
            "scan_depth": req.scan_depth,
            "scanned_fields": len(seen),
            "detected_fields": detected[: req.limit],
        }

    # ── PII 规则 CRUD ─────────────────────────────────────────────────────
    def list_pii_rules(self, tenant_id: int, object_type: str | None) -> list[dict]:
        sql = "SELECT * FROM pii_rules WHERE tenant_id=%s"
        params: list[Any] = [tenant_id]
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            rows = [self._loads(r, "target_objects") for r in cur.fetchall()]
        if object_type:
            rows = [
                r for r in rows
                if not r.get("target_objects") or object_type in (r.get("target_objects") or [])
            ]
        return rows

    def create_pii_rule(self, req: PiiRuleCreate) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pii_rules
                    (tenant_id, field_name, category, action, scope, source, target_objects, created_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE
                    category=VALUES(category), action=VALUES(action), scope=VALUES(scope),
                    source=VALUES(source), target_objects=VALUES(target_objects), is_active=1
                """,
                (
                    req.tenant_id, req.field_name, req.category, req.action, req.scope, req.source,
                    json.dumps(req.target_objects or [], ensure_ascii=False), req.created_by,
                ),
            )
            cur.execute(
                "SELECT rule_id, created_at FROM pii_rules WHERE tenant_id=%s AND field_name=%s",
                (req.tenant_id, req.field_name),
            )
            row = cur.fetchone()
        return {"rule_id": row["rule_id"], "created_at": row["created_at"]}

    def update_pii_rule(self, tenant_id: int, rule_id: int, req: PiiRuleUpdate) -> dict:
        sets, params = [], []
        if req.action is not None:
            sets.append("action=%s"); params.append(req.action)
        if req.scope is not None:
            sets.append("scope=%s"); params.append(req.scope)
        if req.category is not None:
            sets.append("category=%s"); params.append(req.category)
        if req.target_objects is not None:
            sets.append("target_objects=%s")
            params.append(json.dumps(req.target_objects, ensure_ascii=False))
        if req.is_active is not None:
            sets.append("is_active=%s"); params.append(req.is_active)
        if not sets:
            raise ValueError("无可更新字段")
        params.extend([tenant_id, rule_id])
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"UPDATE pii_rules SET {', '.join(sets)} WHERE tenant_id=%s AND rule_id=%s",
                params,
            )
            if cur.rowcount == 0:
                cur.execute(
                    "SELECT rule_id FROM pii_rules WHERE tenant_id=%s AND rule_id=%s",
                    (tenant_id, rule_id),
                )
                if not cur.fetchone():
                    raise KeyError("规则不存在")
            cur.execute(
                "SELECT updated_at FROM pii_rules WHERE tenant_id=%s AND rule_id=%s",
                (tenant_id, rule_id),
            )
            row = cur.fetchone()
        return {"updated_at": row["updated_at"]}

    def delete_pii_rule(self, tenant_id: int, rule_id: int, hard: bool = False) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            if hard:
                cur.execute(
                    "DELETE FROM pii_rules WHERE tenant_id=%s AND rule_id=%s",
                    (tenant_id, rule_id),
                )
            else:
                cur.execute(
                    "UPDATE pii_rules SET is_active=0 WHERE tenant_id=%s AND rule_id=%s",
                    (tenant_id, rule_id),
                )
            ok = cur.rowcount > 0
        return {"ok": ok}

    # ── 同意分类 ──────────────────────────────────────────────────────────
    def list_consent_categories(self, tenant_id: int) -> list[dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM consent_categories WHERE tenant_id=%s ORDER BY category_id",
                (tenant_id,),
            )
            cats = [self._loads(r, "vendor_list") for r in cur.fetchall()]
            # 计算各分类授权率
            cur.execute(
                """
                SELECT category_id,
                       COUNT(*) AS total,
                       SUM(CASE WHEN granted=1 AND withdrawn_at IS NULL THEN 1 ELSE 0 END) AS opted_in
                FROM consent_records WHERE tenant_id=%s GROUP BY category_id
                """,
                (tenant_id,),
            )
            stats = {r["category_id"]: r for r in cur.fetchall()}
        for c in cats:
            st = stats.get(c["category_id"])
            total = (st or {}).get("total") or 0
            opted = (st or {}).get("opted_in") or 0
            c["optedIn_pct"] = round(opted / total * 100, 1) if total else 0.0
            c["vendors"] = c.get("vendor_list") or []
        return cats

    def create_consent_category(self, req: ConsentCategoryCreate) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO consent_categories
                    (tenant_id, category_name, description, is_required, vendor_list, created_by)
                VALUES (%s,%s,%s,%s,%s,%s)
                """,
                (
                    req.tenant_id, req.category_name, req.description, int(req.is_required),
                    json.dumps(req.vendor_list or [], ensure_ascii=False), req.created_by,
                ),
            )
            cur.execute("SELECT category_id, created_at FROM consent_categories WHERE category_id=LAST_INSERT_ID()")
            row = cur.fetchone()
        return {"category_id": row["category_id"], "created_at": row["created_at"]}

    def update_consent_category(self, tenant_id: int, category_id: int, req: ConsentCategoryUpdate) -> dict:
        sets, params = [], []
        if req.category_name is not None:
            sets.append("category_name=%s"); params.append(req.category_name)
        if req.description is not None:
            sets.append("description=%s"); params.append(req.description)
        if req.is_required is not None:
            sets.append("is_required=%s"); params.append(int(req.is_required))
        if req.vendor_list is not None:
            sets.append("vendor_list=%s")
            params.append(json.dumps(req.vendor_list, ensure_ascii=False))
        if not sets:
            raise ValueError("无可更新字段")
        params.extend([tenant_id, category_id])
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"UPDATE consent_categories SET {', '.join(sets)} WHERE tenant_id=%s AND category_id=%s",
                params,
            )
            cur.execute(
                "SELECT updated_at FROM consent_categories WHERE tenant_id=%s AND category_id=%s",
                (tenant_id, category_id),
            )
            row = cur.fetchone()
        if not row:
            raise KeyError("分类不存在")
        return {"updated_at": row["updated_at"]}

    # ── 同意记录 ──────────────────────────────────────────────────────────
    def record_consent(self, req: ConsentRecordCreate) -> dict:
        withdrawn = None if req.granted else datetime.now()
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO consent_records
                    (tenant_id, one_id, identifier, category_id, granted, withdrawn_at)
                VALUES (%s,%s,%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE
                    granted=VALUES(granted), identifier=VALUES(identifier),
                    withdrawn_at=VALUES(withdrawn_at)
                """,
                (req.tenant_id, req.one_id, req.identifier, req.category_id,
                 int(req.granted), withdrawn),
            )
            cur.execute(
                "SELECT record_id, created_at FROM consent_records "
                "WHERE tenant_id=%s AND one_id<=>%s AND category_id=%s ORDER BY record_id DESC LIMIT 1",
                (req.tenant_id, req.one_id, req.category_id),
            )
            row = cur.fetchone()
            # 写隐私审计
            self._audit(cur, req.tenant_id, "consent_change", one_id=req.one_id,
                        scope=f"category:{req.category_id}", affected=1,
                        detail={"granted": req.granted, "identifier": req.identifier})
        return {"record_id": row["record_id"] if row else None,
                "created_at": row["created_at"] if row else None}

    def get_consent(self, tenant_id: int, one_id: int) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT r.category_id, c.category_name, r.granted, r.created_at AS granted_at,
                       r.withdrawn_at
                FROM consent_records r
                LEFT JOIN consent_categories c
                       ON r.tenant_id=c.tenant_id AND r.category_id=c.category_id
                WHERE r.tenant_id=%s AND r.one_id=%s
                ORDER BY r.category_id
                """,
                (tenant_id, one_id),
            )
            rows = list(cur.fetchall())
        return {"one_id": one_id, "records": rows}

    # ── 删除/抑制工单 ─────────────────────────────────────────────────────
    def list_deletion_requests(self, tenant_id: int, status: str | None,
                               limit: int, offset: int) -> dict:
        where = "tenant_id=%s"
        params: list[Any] = [tenant_id]
        if status:
            where += " AND status=%s"; params.append(status)
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) AS c FROM deletion_requests WHERE {where}", params)
            total = cur.fetchone()["c"]
            cur.execute(
                f"SELECT * FROM deletion_requests WHERE {where} "
                f"ORDER BY request_id DESC LIMIT %s OFFSET %s",
                params + [min(max(limit, 1), 500), max(offset, 0)],
            )
            rows = [self._loads(r, "affected_tables") for r in cur.fetchall()]
        return {"requests": rows, "total": total}

    def create_deletion_request(self, req: DeletionRequestCreate) -> dict:
        rtype = "both" if req.request_type == "both" else req.request_type
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO deletion_requests
                    (tenant_id, identifier, one_id, request_type, reason, status, created_by)
                VALUES (%s,%s,%s,%s,%s,'pending',%s)
                """,
                (req.tenant_id, req.identifier, req.one_id, rtype, req.reason, req.created_by),
            )
            cur.execute(
                "SELECT request_id, status, created_at FROM deletion_requests WHERE request_id=LAST_INSERT_ID()"
            )
            row = cur.fetchone()
        return {"request_id": row["request_id"], "status": row["status"], "created_at": row["created_at"]}

    def get_deletion_request(self, tenant_id: int, request_id: int) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM deletion_requests WHERE tenant_id=%s AND request_id=%s",
                (tenant_id, request_id),
            )
            req = self._loads(cur.fetchone(), "affected_tables")
            if not req:
                raise KeyError("工单不存在")
            cur.execute(
                "SELECT * FROM privacy_audit_log WHERE tenant_id=%s AND deletion_request_id=%s "
                "ORDER BY audit_id",
                (tenant_id, request_id),
            )
            audit = [self._loads(r, "detail") for r in cur.fetchall()]
        req["audit_log"] = audit
        return req

    def _resolve_one_id(self, cur, tenant_id: int, identifier: str | None,
                        one_id: int | None) -> int | None:
        if one_id:
            return one_id
        if not identifier:
            return None
        cur.execute(
            "SELECT one_id FROM id_mapping WHERE tenant_id=%s AND channel_id=%s LIMIT 1",
            (tenant_id, identifier),
        )
        row = cur.fetchone()
        if row:
            return row["one_id"]
        cur.execute(
            "SELECT one_id FROM doris_user_wide "
            "WHERE tenant_id=%s AND (phone=%s OR email=%s) LIMIT 1",
            (tenant_id, identifier, identifier),
        )
        row = cur.fetchone()
        return row["one_id"] if row else None

    def execute_deletion(self, tenant_id: int, request_id: int, confirm: bool) -> dict:
        if not confirm:
            raise ValueError("必须 confirm=true 才能执行删除/抑制（不可逆操作）")
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM deletion_requests WHERE tenant_id=%s AND request_id=%s",
                (tenant_id, request_id),
            )
            req = cur.fetchone()
            if not req:
                raise KeyError("工单不存在")
            if req["status"] == "completed":
                raise ValueError("工单已执行，禁止重复执行")

            cur.execute(
                "UPDATE deletion_requests SET status='processing' WHERE tenant_id=%s AND request_id=%s",
                (tenant_id, request_id),
            )

            identifier = req["identifier"]
            one_id = self._resolve_one_id(cur, tenant_id, identifier, req["one_id"])
            rtype = req["request_type"]
            affected: dict[str, int] = {}
            total = 0

            # 删除（delete / both）：清理身份与画像数据
            if rtype in ("delete", "both") and one_id is not None:
                for target in _DELETE_TARGETS:
                    if target.get("extra_one_id"):
                        params = (tenant_id, one_id, one_id)
                    else:
                        params = (tenant_id, one_id)
                    cur.execute(f"DELETE FROM {target['table']} WHERE {target['where']}", params)
                    if cur.rowcount:
                        affected[target["table"]] = cur.rowcount
                        total += cur.rowcount

            # 抑制（suppress / both）：写入抑制名单，阻止后续采集/转发
            if rtype in ("suppress", "both"):
                sup_type = "both" if rtype == "both" else "collect"
                cur.execute(
                    """
                    INSERT INTO suppression_list
                        (tenant_id, identifier, one_id, suppression_type, reason, deletion_request_id)
                    VALUES (%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                        one_id=VALUES(one_id), suppression_type=VALUES(suppression_type),
                        reason=VALUES(reason), deletion_request_id=VALUES(deletion_request_id)
                    """,
                    (tenant_id, identifier or (str(one_id) if one_id else None), one_id,
                     sup_type, req["reason"], request_id),
                )
                affected["suppression_list"] = cur.rowcount
                total += 1

            executed_at = datetime.now()
            cur.execute(
                "UPDATE deletion_requests SET status='completed', affected_tables=%s, "
                "affected_count=%s, executed_at=%s WHERE tenant_id=%s AND request_id=%s",
                (json.dumps(affected, ensure_ascii=False), total, executed_at, tenant_id, request_id),
            )
            audit_id = self._audit(
                cur, tenant_id, "delete" if rtype == "delete" else rtype,
                deletion_request_id=request_id, one_id=one_id,
                scope=f"identifier:{identifier}", affected=total,
                detail={"affected_tables": affected, "request_type": rtype},
            )
        return {
            "status": "completed",
            "affected_tables": affected,
            "executed_at": executed_at,
            "audit_id": audit_id,
        }

    # ── 抑制名单校验 ──────────────────────────────────────────────────────
    def suppression_check(self, tenant_id: int, identifier: str | None,
                          one_id: int | None) -> dict:
        if not identifier and one_id is None:
            raise ValueError("identifier 与 one_id 至少提供其一")
        clauses, params = [], [tenant_id]
        if identifier:
            clauses.append("identifier=%s"); params.append(identifier)
        if one_id is not None:
            clauses.append("one_id=%s"); params.append(one_id)
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT * FROM suppression_list WHERE tenant_id=%s AND ({' OR '.join(clauses)}) "
                f"ORDER BY suppression_id DESC LIMIT 1",
                params,
            )
            row = cur.fetchone()
        if not row:
            return {"suppressed": False}
        expires = row.get("expires_at")
        if expires and expires < datetime.now():
            return {"suppressed": False, "reason": "已过期", "expires_at": expires}
        return {
            "suppressed": True,
            "reason": row.get("reason"),
            "suppression_type": row.get("suppression_type"),
            "expires_at": expires,
        }

    # ── 审计 ──────────────────────────────────────────────────────────────
    def _audit(self, cur, tenant_id: int, operation_type: str, *,
               deletion_request_id: int | None = None, operator: str | None = None,
               one_id: int | None = None, scope: str | None = None,
               affected: int = 0, detail: dict | None = None) -> int:
        cur.execute(
            """
            INSERT INTO privacy_audit_log
                (tenant_id, operation_type, deletion_request_id, operator, one_id,
                 scope, affected_records, detail)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (tenant_id, operation_type, deletion_request_id, operator, one_id, scope,
             affected, json.dumps(detail or {}, ensure_ascii=False)),
        )
        cur.execute("SELECT LAST_INSERT_ID() AS id")
        return cur.fetchone()["id"]

    def query_audit_logs(self, req: AuditLogQuery) -> dict:
        where = "tenant_id=%s"
        params: list[Any] = [req.tenant_id]
        if req.operation_type:
            where += " AND operation_type=%s"; params.append(req.operation_type)
        if req.request_id is not None:
            where += " AND deletion_request_id=%s"; params.append(req.request_id)
        if req.start_date:
            where += " AND created_at >= %s"; params.append(req.start_date)
        if req.end_date:
            where += " AND created_at <= %s"; params.append(req.end_date)
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) AS c FROM privacy_audit_log WHERE {where}", params)
            total = cur.fetchone()["c"]
            cur.execute(
                f"SELECT * FROM privacy_audit_log WHERE {where} "
                f"ORDER BY audit_id DESC LIMIT %s OFFSET %s",
                params + [min(max(req.limit, 1), 500), max(req.offset, 0)],
            )
            logs = [self._loads(r, "detail") for r in cur.fetchall()]
        return {"logs": logs, "total": total}


# ════════════════════════════════════════════════════════════════════════
# Router
# ════════════════════════════════════════════════════════════════════════

router = APIRouter(prefix="/privacy", tags=["privacy"])
service = PrivacyService()


# ── PII ────────────────────────────────────────────────────────────────
@router.post("/pii/scan", summary="扫描疑似 PII 字段")
def pii_scan(body: PiiScanRequest):
    return service.pii_scan(body)


@router.get("/pii/rules", summary="查询 PII 规则")
def list_pii_rules(tenant_id: int = Query(...), object_type: str | None = None):
    return {"rules": service.list_pii_rules(tenant_id, object_type)}


@router.post("/pii/rules", summary="创建 PII 管控规则")
def create_pii_rule(body: PiiRuleCreate):
    return service.create_pii_rule(body)


@router.put("/pii/rules/{rule_id}", summary="更新 PII 规则")
def update_pii_rule(rule_id: int, body: PiiRuleUpdate, tenant_id: int = Query(...)):
    try:
        return service.update_pii_rule(tenant_id, rule_id, body)
    except KeyError:
        raise HTTPException(status_code=404, detail="规则不存在")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/pii/rules/{rule_id}", summary="禁用/删除 PII 规则")
def delete_pii_rule(rule_id: int, tenant_id: int = Query(...), hard: bool = False):
    return service.delete_pii_rule(tenant_id, rule_id, hard)


# ── 同意分类 ──────────────────────────────────────────────────────────
@router.get("/consent/categories", summary="列出同意分类")
def list_consent_categories(tenant_id: int = Query(...)):
    return {"categories": service.list_consent_categories(tenant_id)}


@router.post("/consent/categories", summary="创建同意分类")
def create_consent_category(body: ConsentCategoryCreate):
    return service.create_consent_category(body)


@router.put("/consent/categories/{category_id}", summary="更新同意分类")
def update_consent_category(category_id: int, body: ConsentCategoryUpdate, tenant_id: int = Query(...)):
    try:
        return service.update_consent_category(tenant_id, category_id, body)
    except KeyError:
        raise HTTPException(status_code=404, detail="分类不存在")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── 同意记录 ──────────────────────────────────────────────────────────
@router.post("/consent", summary="记录用户授权状态")
def record_consent(body: ConsentRecordCreate):
    return service.record_consent(body)


@router.get("/consent/{one_id}", summary="查询用户同意状态")
def get_consent(one_id: int, tenant_id: int = Query(...)):
    return service.get_consent(tenant_id, one_id)


# ── 删除/抑制工单 ─────────────────────────────────────────────────────
@router.get("/deletion", summary="列出删除/抑制工单")
def list_deletion_requests(tenant_id: int = Query(...), status: str | None = None,
                           limit: int = 50, offset: int = 0):
    return service.list_deletion_requests(tenant_id, status, limit, offset)


@router.post("/deletion", summary="创建删除/抑制工单")
def create_deletion_request(body: DeletionRequestCreate):
    return service.create_deletion_request(body)


@router.post("/deletion/{request_id}/execute", summary="执行删除/抑制")
def execute_deletion(request_id: int, body: DeletionExecuteRequest, tenant_id: int = Query(...)):
    try:
        return service.execute_deletion(tenant_id, request_id, body.confirm)
    except KeyError:
        raise HTTPException(status_code=404, detail="工单不存在")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/deletion/{request_id}", summary="查询工单详情与回执")
def get_deletion_request(request_id: int, tenant_id: int = Query(...)):
    try:
        return service.get_deletion_request(tenant_id, request_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="工单不存在")


# ── 抑制校验 ──────────────────────────────────────────────────────────
@router.get("/suppression/check", summary="校验是否在抑制名单")
def suppression_check(tenant_id: int = Query(...), identifier: str | None = None,
                      one_id: int | None = None):
    try:
        return service.suppression_check(tenant_id, identifier, one_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── 审计 ──────────────────────────────────────────────────────────────
@router.post("/audit/logs", summary="查询隐私操作审计日志")
def query_audit_logs(body: AuditLogQuery):
    return service.query_audit_logs(body)
