"""09-settings 模块 —— 工作区设置 / IAM（成员·角色·团队·邀请·API令牌·审计）

设计原则（与项目铁律一致）：
- 只做加法：自带 APIRouter + Service + Pydantic 模型，不改 main.py / schemas.py / 既有 service。
- 所有 SQL 参数化（%s 占位），绝不字符串拼接 SQL，绝不让 LLM 产出 SQL。
- 多租户：所有读写按 tenant_id 隔离；以 PK(id) 定位的更新/删除可选叠加 tenant_id 校验。
- 复用 MysqlOlapExecutor 取连接配置（与 groups.py / tags.py / segments.py 同款）。

路由说明：本 router 不加 prefix。因为前端契约为 /api/iam/* 与 /api/tenants/*，
nginx 会剥离 /api 前缀，sql-engine 实际收到 /iam/* 与 /tenants/*，故路径直接如此声明。
"""

from __future__ import annotations

import hashlib
import json
import secrets
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Any

import pymysql
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from executor import MysqlOlapExecutor

# ════════════════════════════════════════════════════════════════════════════
# Pydantic 模型（本模块自包含，不写进 schemas.py）
# ════════════════════════════════════════════════════════════════════════════


class TenantUpdate(BaseModel):
    name: str | None = None
    region: str | None = None
    plan: str | None = None


class UserCreate(BaseModel):
    tenant_id: int
    email: str
    name: str | None = None
    role_id: int | None = None


class UserUpdate(BaseModel):
    name: str | None = None
    status: str | None = Field(default=None, description="active/inactive/pending")


class RoleCreate(BaseModel):
    tenant_id: int
    name: str
    scope: dict[str, Any] = Field(default_factory=dict, description="{modules, permissions}")


class RoleUpdate(BaseModel):
    name: str | None = None
    scope: dict[str, Any] | None = None


class TeamCreate(BaseModel):
    tenant_id: int
    name: str
    description: str | None = None


class TeamMemberAdd(BaseModel):
    user_id: int


class InvitationCreate(BaseModel):
    tenant_id: int
    email: str
    role_id: int
    teams: list[int] = Field(default_factory=list)
    invited_by: int | None = Field(default=None, description="邀请人 user_id，缺省记 0")


class InvitationAccept(BaseModel):
    password: str | None = None
    name: str | None = None


class TokenCreate(BaseModel):
    tenant_id: int
    label: str
    scopes: list[str] = Field(default_factory=list)
    created_by: int | None = Field(default=None, description="创建者 user_id，缺省记 0")


class AuditCreate(BaseModel):
    tenant_id: int
    actor: str
    action: str
    target: str
    module: str | None = "settings"
    details: dict[str, Any] | None = None


# ════════════════════════════════════════════════════════════════════════════
# Service
# ════════════════════════════════════════════════════════════════════════════


class SettingsService:
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

    # ── 工具 ────────────────────────────────────────────────────────────────

    @staticmethod
    def _jload(row: dict | None, *keys: str) -> dict | None:
        if not row:
            return row
        for k in keys:
            if k in row and isinstance(row[k], str):
                try:
                    row[k] = json.loads(row[k])
                except (json.JSONDecodeError, TypeError):
                    pass
        return row

    def _audit(
        self,
        cur,
        tenant_id: int,
        actor: str,
        action: str,
        target: str,
        module: str = "settings",
        details: dict | None = None,
    ) -> None:
        cur.execute(
            """
            INSERT INTO audit_log (tenant_id, actor, action, target, module, details)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                tenant_id, actor, action, target, module,
                json.dumps(details or {}, ensure_ascii=False),
            ),
        )

    def _tenant_config_get(self, cur, tenant_id: int, domain: str) -> dict:
        cur.execute(
            "SELECT config_key, config_value FROM tenant_config "
            "WHERE tenant_id=%s AND config_domain=%s",
            (tenant_id, domain),
        )
        out: dict[str, Any] = {}
        for r in cur.fetchall():
            val = r["config_value"]
            if isinstance(val, str):
                try:
                    val = json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    pass
            out[r["config_key"]] = val
        return out

    def _tenant_config_set(self, cur, tenant_id: int, domain: str, key: str, value: Any, actor: str) -> None:
        cur.execute(
            """
            INSERT INTO tenant_config (tenant_id, config_domain, config_key, config_value, updated_by)
            VALUES (%s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE config_value=VALUES(config_value), updated_by=VALUES(updated_by)
            """,
            (tenant_id, domain, key, json.dumps(value, ensure_ascii=False), actor),
        )

    # ── 工作区 tenants ────────────────────────────────────────────────────────

    def get_tenant(self, tenant_id: int) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT tenant_id, tenant_name, tier, kafka_topic, created_at "
                    "FROM tenants WHERE tenant_id=%s",
                    (tenant_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                cfg = self._tenant_config_get(cur, tenant_id, "基础")
                return {
                    "id": row["tenant_id"],
                    "name": row["tenant_name"],
                    "slug": cfg.get("slug") or f"tenant-{row['tenant_id']}",
                    "region": cfg.get("region") or "cn-east",
                    "plan": cfg.get("plan") or ("premium" if row["tier"] == "premium" else "standard"),
                    "created_at": row["created_at"],
                    "tier": row["tier"],
                    "kafka_topic": row["kafka_topic"],
                }

    def update_tenant(self, tenant_id: int, data: TenantUpdate, actor: str) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT tenant_id, tenant_name FROM tenants WHERE tenant_id=%s", (tenant_id,))
                row = cur.fetchone()
                if not row:
                    return None
                old = {"name": row["tenant_name"]}
                old.update(self._tenant_config_get(cur, tenant_id, "基础"))
                if data.name is not None:
                    cur.execute(
                        "UPDATE tenants SET tenant_name=%s WHERE tenant_id=%s",
                        (data.name, tenant_id),
                    )
                if data.region is not None:
                    self._tenant_config_set(cur, tenant_id, "基础", "region", data.region, actor)
                if data.plan is not None:
                    self._tenant_config_set(cur, tenant_id, "基础", "plan", data.plan, actor)
                self._audit(
                    cur, tenant_id, actor, "update", "workspace", "settings",
                    {"old": old, "new": data.model_dump(exclude_none=True)},
                )
        return {**(self.get_tenant(tenant_id) or {}), "updated_at": datetime.utcnow().isoformat()}

    # ── 成员 users ────────────────────────────────────────────────────────────

    def list_users(
        self, tenant_id: int, limit: int = 50, offset: int = 0, status: str | None = None
    ) -> dict:
        limit = min(max(limit, 1), 200)
        offset = max(offset, 0)
        where = "u.tenant_id=%s"
        params: list[Any] = [tenant_id]
        if status:
            where += " AND u.status=%s"
            params.append(status)
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT COUNT(*) AS c FROM users u WHERE {where}", params)
                total = cur.fetchone()["c"]
                cur.execute(
                    f"""
                    SELECT u.id, u.email, u.name, u.status, u.created_at,
                           GROUP_CONCAT(DISTINCT r.name) AS roles,
                           GROUP_CONCAT(DISTINCT t.name) AS teams
                    FROM users u
                    LEFT JOIN user_roles ur ON ur.user_id=u.id
                    LEFT JOIN roles r ON r.id=ur.role_id AND r.tenant_id=u.tenant_id
                    LEFT JOIN team_members tm ON tm.user_id=u.id
                    LEFT JOIN teams t ON t.id=tm.team_id AND t.tenant_id=u.tenant_id
                    WHERE {where}
                    GROUP BY u.id, u.email, u.name, u.status, u.created_at
                    ORDER BY u.id DESC
                    LIMIT %s OFFSET %s
                    """,
                    [*params, limit, offset],
                )
                rows = cur.fetchall()
                for r in rows:
                    roles = (r.pop("roles") or "").split(",") if r.get("roles") else []
                    r["role"] = roles[0] if roles else None
                    r["teams"] = (r["teams"] or "").split(",") if r.get("teams") else []
                return {"total": total, "data": rows}

    def create_user(self, data: UserCreate) -> dict:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO users (tenant_id, email, name, status) VALUES (%s, %s, %s, 'pending')",
                    (data.tenant_id, data.email, data.name),
                )
                cur.execute("SELECT LAST_INSERT_ID() AS id")
                user_id = cur.fetchone()["id"]
                if data.role_id is not None:
                    cur.execute(
                        "INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (%s, %s)",
                        (user_id, data.role_id),
                    )
                    self._refresh_role_count(cur, data.tenant_id, data.role_id)
                self._audit(cur, data.tenant_id, "system", "create_member", data.email,
                            "settings", {"user_id": user_id, "role_id": data.role_id})
                return {"id": user_id, "email": data.email, "name": data.name, "status": "pending"}

    def update_user(self, user_id: int, data: UserUpdate, tenant_id: int | None = None) -> dict | None:
        sets: list[str] = []
        params: list[Any] = []
        if data.name is not None:
            sets.append("name=%s")
            params.append(data.name)
        if data.status is not None:
            if data.status not in ("active", "inactive", "pending"):
                raise ValueError("status 仅支持 active/inactive/pending")
            sets.append("status=%s")
            params.append(data.status)
        with self._conn() as conn:
            with conn.cursor() as cur:
                if sets:
                    where = "id=%s"
                    wparams = [user_id]
                    if tenant_id is not None:
                        where += " AND tenant_id=%s"
                        wparams.append(tenant_id)
                    cur.execute(f"UPDATE users SET {', '.join(sets)} WHERE {where}", [*params, *wparams])
                cur.execute(
                    "SELECT id, tenant_id, email, name, status, updated_at FROM users WHERE id=%s",
                    (user_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                self._audit(cur, row["tenant_id"], "system", "update_member", row["email"],
                            "settings", data.model_dump(exclude_none=True))
                return row

    def delete_user(self, user_id: int, tenant_id: int | None = None) -> bool:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT tenant_id, email FROM users WHERE id=%s", (user_id,))
                row = cur.fetchone()
                if not row:
                    return False
                if tenant_id is not None and row["tenant_id"] != tenant_id:
                    return False
                cur.execute("DELETE FROM user_roles WHERE user_id=%s", (user_id,))
                cur.execute("DELETE FROM team_members WHERE user_id=%s", (user_id,))
                cur.execute("DELETE FROM users WHERE id=%s", (user_id,))
                self._audit(cur, row["tenant_id"], "system", "delete_member", row["email"], "settings")
                return True

    # ── 角色 roles ────────────────────────────────────────────────────────────

    def _refresh_role_count(self, cur, tenant_id: int, role_id: int) -> None:
        cur.execute(
            "UPDATE roles SET member_count=(SELECT COUNT(*) FROM user_roles WHERE role_id=%s) "
            "WHERE id=%s AND tenant_id=%s",
            (role_id, role_id, tenant_id),
        )

    def list_roles(self, tenant_id: int) -> list[dict]:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT r.id, r.name, r.scope,
                           (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id=r.id) AS member_count
                    FROM roles r WHERE r.tenant_id=%s ORDER BY r.id
                    """,
                    (tenant_id,),
                )
                return [self._jload(r, "scope") for r in cur.fetchall()]

    def create_role(self, data: RoleCreate) -> dict:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO roles (tenant_id, name, scope) VALUES (%s, %s, %s)",
                    (data.tenant_id, data.name, json.dumps(data.scope, ensure_ascii=False)),
                )
                cur.execute("SELECT id, name, scope, created_at FROM roles WHERE id=LAST_INSERT_ID()")
                row = self._jload(cur.fetchone(), "scope")
                self._audit(cur, data.tenant_id, "system", "create_role", data.name, "settings")
                return row

    def update_role(self, role_id: int, data: RoleUpdate, tenant_id: int | None = None) -> dict | None:
        sets: list[str] = []
        params: list[Any] = []
        if data.name is not None:
            sets.append("name=%s")
            params.append(data.name)
        if data.scope is not None:
            sets.append("scope=%s")
            params.append(json.dumps(data.scope, ensure_ascii=False))
        with self._conn() as conn:
            with conn.cursor() as cur:
                if sets:
                    where = "id=%s"
                    wparams = [role_id]
                    if tenant_id is not None:
                        where += " AND tenant_id=%s"
                        wparams.append(tenant_id)
                    cur.execute(f"UPDATE roles SET {', '.join(sets)} WHERE {where}", [*params, *wparams])
                cur.execute("SELECT id, tenant_id, name, scope, updated_at FROM roles WHERE id=%s", (role_id,))
                row = cur.fetchone()
                if not row:
                    return None
                self._audit(cur, row["tenant_id"], "system", "update_role", row["name"], "settings")
                return self._jload(row, "scope")

    def delete_role(self, role_id: int, tenant_id: int | None = None) -> bool:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT tenant_id, name FROM roles WHERE id=%s", (role_id,))
                row = cur.fetchone()
                if not row:
                    return False
                if tenant_id is not None and row["tenant_id"] != tenant_id:
                    return False
                cur.execute("DELETE FROM user_roles WHERE role_id=%s", (role_id,))
                cur.execute("DELETE FROM roles WHERE id=%s", (role_id,))
                self._audit(cur, row["tenant_id"], "system", "delete_role", row["name"], "settings")
                return True

    # ── 团队 teams ────────────────────────────────────────────────────────────

    def list_teams(self, tenant_id: int) -> list[dict]:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT t.id, t.name, t.description,
                           (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id=t.id) AS member_count
                    FROM teams t WHERE t.tenant_id=%s ORDER BY t.id
                    """,
                    (tenant_id,),
                )
                return list(cur.fetchall())

    def create_team(self, data: TeamCreate) -> dict:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO teams (tenant_id, name, description) VALUES (%s, %s, %s)",
                    (data.tenant_id, data.name, data.description),
                )
                cur.execute("SELECT id, name, created_at FROM teams WHERE id=LAST_INSERT_ID()")
                row = cur.fetchone()
                self._audit(cur, data.tenant_id, "system", "create_team", data.name, "settings")
                return row

    def add_team_member(self, team_id: int, user_id: int) -> bool:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT tenant_id FROM teams WHERE id=%s", (team_id,))
                team = cur.fetchone()
                if not team:
                    return False
                cur.execute(
                    "INSERT IGNORE INTO team_members (team_id, user_id) VALUES (%s, %s)",
                    (team_id, user_id),
                )
                self._audit(cur, team["tenant_id"], "system", "add_team_member",
                            f"team:{team_id}", "settings", {"user_id": user_id})
                return True

    def remove_team_member(self, team_id: int, user_id: int) -> bool:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT tenant_id FROM teams WHERE id=%s", (team_id,))
                team = cur.fetchone()
                cur.execute(
                    "DELETE FROM team_members WHERE team_id=%s AND user_id=%s",
                    (team_id, user_id),
                )
                deleted = cur.rowcount > 0
                if deleted and team:
                    self._audit(cur, team["tenant_id"], "system", "remove_team_member",
                                f"team:{team_id}", "settings", {"user_id": user_id})
                return deleted

    # ── 邀请 invitations ──────────────────────────────────────────────────────

    def create_invitation(self, data: InvitationCreate) -> dict:
        token = secrets.token_urlsafe(32)
        expires_at = datetime.utcnow() + timedelta(days=7)
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO invitations (tenant_id, email, role_id, token, status, invited_by, expires_at)
                    VALUES (%s, %s, %s, %s, 'pending', %s, %s)
                    """,
                    (data.tenant_id, data.email, data.role_id, token,
                     data.invited_by or 0, expires_at),
                )
                cur.execute("SELECT LAST_INSERT_ID() AS id")
                inv_id = cur.fetchone()["id"]
                self._audit(cur, data.tenant_id, "system", "invite_member", data.email,
                            "settings", {"role_id": data.role_id, "teams": data.teams})
                return {
                    "id": inv_id,
                    "token": token,
                    "email": data.email,
                    "expires_at": expires_at.isoformat(),
                    "invitation_url": f"/console/invitations/{token}/accept",
                }

    def list_invitations(self, tenant_id: int, status: str | None = None) -> list[dict]:
        where = "i.tenant_id=%s"
        params: list[Any] = [tenant_id]
        if status:
            where += " AND i.status=%s"
            params.append(status)
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT i.id, i.email, r.name AS role, i.status, i.expires_at,
                           u.email AS invited_by
                    FROM invitations i
                    LEFT JOIN roles r ON r.id=i.role_id
                    LEFT JOIN users u ON u.id=i.invited_by
                    WHERE {where}
                    ORDER BY i.id DESC
                    """,
                    params,
                )
                return list(cur.fetchall())

    def accept_invitation(self, token: str, data: InvitationAccept) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, tenant_id, email, role_id, status, expires_at "
                    "FROM invitations WHERE token=%s",
                    (token,),
                )
                inv = cur.fetchone()
                if not inv:
                    return None
                if inv["status"] != "pending":
                    raise ValueError("邀请已被处理或已失效")
                if inv["expires_at"] and inv["expires_at"] < datetime.utcnow():
                    cur.execute("UPDATE invitations SET status='expired' WHERE id=%s", (inv["id"],))
                    raise ValueError("邀请已过期")
                # 落地 / 激活成员
                cur.execute(
                    """
                    INSERT INTO users (tenant_id, email, name, status)
                    VALUES (%s, %s, %s, 'active')
                    ON DUPLICATE KEY UPDATE name=COALESCE(VALUES(name), name), status='active'
                    """,
                    (inv["tenant_id"], inv["email"], data.name),
                )
                cur.execute(
                    "SELECT id FROM users WHERE tenant_id=%s AND email=%s",
                    (inv["tenant_id"], inv["email"]),
                )
                user_id = cur.fetchone()["id"]
                if inv["role_id"]:
                    cur.execute(
                        "INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (%s, %s)",
                        (user_id, inv["role_id"]),
                    )
                    self._refresh_role_count(cur, inv["tenant_id"], inv["role_id"])
                cur.execute(
                    "UPDATE invitations SET status='accepted', accepted_at=NOW() WHERE id=%s",
                    (inv["id"],),
                )
                self._audit(cur, inv["tenant_id"], inv["email"], "accept_invitation",
                            inv["email"], "settings", {"user_id": user_id})
                return {"user_id": user_id, "status": "active"}

    def cancel_invitation(self, invitation_id: int, tenant_id: int | None = None) -> bool:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT tenant_id, email FROM invitations WHERE id=%s", (invitation_id,))
                inv = cur.fetchone()
                if not inv:
                    return False
                if tenant_id is not None and inv["tenant_id"] != tenant_id:
                    return False
                cur.execute("DELETE FROM invitations WHERE id=%s", (invitation_id,))
                self._audit(cur, inv["tenant_id"], "system", "cancel_invitation",
                            inv["email"], "settings")
                return True

    # ── API 令牌 tokens ───────────────────────────────────────────────────────

    def list_tokens(self, tenant_id: int, limit: int = 50, offset: int = 0) -> dict:
        limit = min(max(limit, 1), 200)
        offset = max(offset, 0)
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS c FROM api_tokens WHERE tenant_id=%s", (tenant_id,))
                total = cur.fetchone()["c"]
                cur.execute(
                    """
                    SELECT id, label, prefix, scopes, created_at, last_used, revoked_at
                    FROM api_tokens WHERE tenant_id=%s
                    ORDER BY id DESC LIMIT %s OFFSET %s
                    """,
                    (tenant_id, limit, offset),
                )
                rows = [self._jload(r, "scopes") for r in cur.fetchall()]
                return {"total": total, "data": rows}

    def issue_token(self, data: TokenCreate) -> dict:
        raw = secrets.token_urlsafe(32)
        plaintext = f"sk_{raw}"
        prefix = plaintext[:8]
        digest = hashlib.sha256(plaintext.encode("utf-8")).hexdigest()
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO api_tokens (tenant_id, label, prefix, hash, scopes, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (data.tenant_id, data.label, prefix, digest,
                     json.dumps(data.scopes, ensure_ascii=False), data.created_by or 0),
                )
                cur.execute(
                    "SELECT id, label, prefix, created_at FROM api_tokens WHERE id=LAST_INSERT_ID()"
                )
                row = cur.fetchone()
                self._audit(cur, data.tenant_id, "system", "issue_token", data.label,
                            "settings", {"token_id": row["id"], "scopes": data.scopes})
                return {
                    "id": row["id"],
                    "label": row["label"],
                    "token_plaintext": plaintext,
                    "prefix": row["prefix"],
                    "created_at": row["created_at"],
                }

    def revoke_token(self, token_id: int, tenant_id: int | None = None) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT tenant_id, label, revoked_at FROM api_tokens WHERE id=%s", (token_id,))
                row = cur.fetchone()
                if not row:
                    return None
                if tenant_id is not None and row["tenant_id"] != tenant_id:
                    return None
                cur.execute(
                    "UPDATE api_tokens SET revoked_at=NOW() WHERE id=%s AND revoked_at IS NULL",
                    (token_id,),
                )
                cur.execute("SELECT revoked_at FROM api_tokens WHERE id=%s", (token_id,))
                revoked_at = cur.fetchone()["revoked_at"]
                self._audit(cur, row["tenant_id"], "system", "revoke_token", row["label"], "settings")
                return {"ok": True, "revoked_at": revoked_at}

    # ── 审计 audit ────────────────────────────────────────────────────────────

    def list_audit(
        self,
        tenant_id: int,
        actor: str | None = None,
        action: str | None = None,
        target: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        limit = min(max(limit, 1), 500)
        offset = max(offset, 0)
        where = "tenant_id=%s"
        params: list[Any] = [tenant_id]
        if actor:
            where += " AND actor=%s"
            params.append(actor)
        if action:
            where += " AND action=%s"
            params.append(action)
        if target:
            where += " AND target LIKE %s"
            params.append(f"%{target}%")
        if date_from:
            where += " AND created_at >= %s"
            params.append(date_from)
        if date_to:
            where += " AND created_at <= %s"
            params.append(date_to)
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT COUNT(*) AS c FROM audit_log WHERE {where}", params)
                total = cur.fetchone()["c"]
                cur.execute(
                    f"""
                    SELECT id, created_at AS time, actor, action, target, module, details
                    FROM audit_log WHERE {where}
                    ORDER BY id DESC LIMIT %s OFFSET %s
                    """,
                    [*params, limit, offset],
                )
                rows = [self._jload(r, "details") for r in cur.fetchall()]
                return {"total": total, "data": rows}

    def create_audit(self, data: AuditCreate) -> dict:
        with self._conn() as conn:
            with conn.cursor() as cur:
                self._audit(cur, data.tenant_id, data.actor, data.action, data.target,
                            data.module or "settings", data.details)
                cur.execute("SELECT id, created_at FROM audit_log WHERE id=LAST_INSERT_ID()")
                return cur.fetchone()


# ════════════════════════════════════════════════════════════════════════════
# Router
# ════════════════════════════════════════════════════════════════════════════

router = APIRouter(tags=["settings"])
_service = SettingsService()


# ── 工作区 ──────────────────────────────────────────────────────────────────

@router.get("/tenants/{tenant_id}")
def get_tenant(tenant_id: int):
    row = _service.get_tenant(tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="工作区不存在")
    return row


@router.patch("/tenants/{tenant_id}")
def update_tenant(tenant_id: int, body: TenantUpdate, actor: str = Query("system")):
    row = _service.update_tenant(tenant_id, body, actor)
    if not row:
        raise HTTPException(status_code=404, detail="工作区不存在")
    return row


# ── 成员 ────────────────────────────────────────────────────────────────────

@router.get("/iam/users")
def list_users(
    tenant_id: int = Query(...),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None),
):
    return _service.list_users(tenant_id, limit, offset, status)


@router.post("/iam/users", status_code=201)
def create_user(body: UserCreate):
    return _service.create_user(body)


@router.patch("/iam/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, tenant_id: int | None = Query(None)):
    try:
        row = _service.update_user(user_id, body, tenant_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not row:
        raise HTTPException(status_code=404, detail="成员不存在")
    return row


@router.delete("/iam/users/{user_id}")
def delete_user(user_id: int, tenant_id: int | None = Query(None)):
    if not _service.delete_user(user_id, tenant_id):
        raise HTTPException(status_code=404, detail="成员不存在")
    return {"ok": True}


# ── 角色 ────────────────────────────────────────────────────────────────────

@router.get("/iam/roles")
def list_roles(tenant_id: int = Query(...)):
    return {"data": _service.list_roles(tenant_id)}


@router.post("/iam/roles", status_code=201)
def create_role(body: RoleCreate):
    return _service.create_role(body)


@router.patch("/iam/roles/{role_id}")
def update_role(role_id: int, body: RoleUpdate, tenant_id: int | None = Query(None)):
    row = _service.update_role(role_id, body, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="角色不存在")
    return row


@router.delete("/iam/roles/{role_id}")
def delete_role(role_id: int, tenant_id: int | None = Query(None)):
    if not _service.delete_role(role_id, tenant_id):
        raise HTTPException(status_code=404, detail="角色不存在")
    return {"ok": True}


# ── 团队 ────────────────────────────────────────────────────────────────────

@router.get("/iam/teams")
def list_teams(tenant_id: int = Query(...)):
    return {"data": _service.list_teams(tenant_id)}


@router.post("/iam/teams", status_code=201)
def create_team(body: TeamCreate):
    return _service.create_team(body)


@router.post("/iam/teams/{team_id}/members")
def add_team_member(team_id: int, body: TeamMemberAdd):
    if not _service.add_team_member(team_id, body.user_id):
        raise HTTPException(status_code=404, detail="团队不存在")
    return {"ok": True}


@router.delete("/iam/teams/{team_id}/members/{user_id}")
def remove_team_member(team_id: int, user_id: int):
    if not _service.remove_team_member(team_id, user_id):
        raise HTTPException(status_code=404, detail="成员不在该团队")
    return {"ok": True}


# ── 邀请 ────────────────────────────────────────────────────────────────────

@router.post("/iam/invitations", status_code=201)
def create_invitation(body: InvitationCreate):
    return _service.create_invitation(body)


@router.get("/iam/invitations")
def list_invitations(tenant_id: int = Query(...), status: str | None = Query(None)):
    return {"data": _service.list_invitations(tenant_id, status)}


@router.post("/iam/invitations/{token}/accept")
def accept_invitation(token: str, body: InvitationAccept):
    try:
        row = _service.accept_invitation(token, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not row:
        raise HTTPException(status_code=404, detail="邀请不存在")
    return row


@router.delete("/iam/invitations/{invitation_id}")
def cancel_invitation(invitation_id: int, tenant_id: int | None = Query(None)):
    if not _service.cancel_invitation(invitation_id, tenant_id):
        raise HTTPException(status_code=404, detail="邀请不存在")
    return {"ok": True}


# ── API 令牌 ──────────────────────────────────────────────────────────────────

@router.get("/iam/tokens")
def list_tokens(
    tenant_id: int = Query(...),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return _service.list_tokens(tenant_id, limit, offset)


@router.post("/iam/tokens", status_code=201)
def issue_token(body: TokenCreate):
    return _service.issue_token(body)


@router.delete("/iam/tokens/{token_id}")
def revoke_token(token_id: int, tenant_id: int | None = Query(None)):
    row = _service.revoke_token(token_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="令牌不存在")
    return row


# ── 审计 ────────────────────────────────────────────────────────────────────

@router.get("/iam/audit")
def list_audit(
    tenant_id: int = Query(...),
    actor: str | None = Query(None),
    action: str | None = Query(None),
    target: str | None = Query(None),
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    return _service.list_audit(tenant_id, actor, action, target, date_from, date_to, limit, offset)


@router.post("/iam/audit", status_code=201)
def create_audit(body: AuditCreate):
    return _service.create_audit(body)
