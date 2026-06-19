"""用户登录（dev 演示级）。

- 只做加法：自带 APIRouter + Service + 模型，不改既有 service。
- 团队成员（users 表）即登录账号，挂在 workspace(tenant) 下。
- 密码：sha256(f"{PEPPER}:{password}")，与 sql/migrate_auth.sql 同源（演示级，非生产强度）。
- 令牌：无状态自签 HMAC token（base64(payload).hmac），不落库；/auth/me 校验。
路由前缀 /auth，经 nginx 暴露为 /api/auth/*。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from contextlib import contextmanager

import pymysql
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from executor import MysqlOlapExecutor

PEPPER = "dataagent"
AUTH_SECRET = os.getenv("AUTH_SECRET", "dataagent-dev-secret")
TOKEN_TTL = int(os.getenv("AUTH_TOKEN_TTL", str(7 * 24 * 3600)))  # 7 天


def _hash_pw(password: str) -> str:
    return hashlib.sha256(f"{PEPPER}:{password}".encode()).hexdigest()


def _sign(payload: dict) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()
    sig = hmac.new(AUTH_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def _verify(token: str) -> dict | None:
    try:
        body, sig = token.split(".", 1)
        expect = hmac.new(AUTH_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expect):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body.encode()).decode())
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except (ValueError, json.JSONDecodeError, Exception):
        return None


class LoginBody(BaseModel):
    email: str
    password: str


class AuthService:
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

    def _user_public(self, cur, user: dict) -> dict:
        """补充部门(teams)与角色，返回前端用的 user 视图。"""
        cur.execute(
            """
            SELECT t.name FROM team_members tm
            JOIN teams t ON t.id = tm.team_id AND t.tenant_id = %s
            WHERE tm.user_id = %s
            """,
            (user["tenant_id"], user["id"]),
        )
        teams = [r["name"] for r in cur.fetchall()]
        cur.execute(
            """
            SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = %s LIMIT 1
            """,
            (user["id"],),
        )
        role = cur.fetchone()
        return {
            "id": user["id"], "name": user["name"], "email": user["email"],
            "tenant_id": user["tenant_id"], "status": user["status"],
            "teams": teams, "role": role["name"] if role else None,
        }

    def login(self, email: str, password: str) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, tenant_id, email, name, status, password_hash "
                "FROM users WHERE email = %s LIMIT 1",
                (email.strip(),),
            )
            user = cur.fetchone()
            if not user or not user.get("password_hash"):
                raise HTTPException(status_code=401, detail="邮箱或密码错误")
            if not hmac.compare_digest(user["password_hash"], _hash_pw(password)):
                raise HTTPException(status_code=401, detail="邮箱或密码错误")
            if user["status"] != "active":
                raise HTTPException(status_code=403, detail="账号未激活或已停用")
            pub = self._user_public(cur, user)
        token = _sign({"uid": user["id"], "tid": user["tenant_id"], "exp": int(time.time()) + TOKEN_TTL})
        return {"token": token, "user": pub}

    def me(self, token: str) -> dict:
        payload = _verify(token)
        if not payload:
            raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, tenant_id, email, name, status FROM users WHERE id = %s LIMIT 1",
                (payload["uid"],),
            )
            user = cur.fetchone()
            if not user:
                raise HTTPException(status_code=401, detail="账号不存在")
            return {"user": self._user_public(cur, user)}


service = AuthService()
router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(body: LoginBody):
    return service.login(body.email, body.password)


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="缺少登录令牌")
    return authorization.split(" ", 1)[1].strip()


@router.get("/me")
def me(authorization: str | None = Header(default=None)):
    return service.me(_bearer(authorization))
