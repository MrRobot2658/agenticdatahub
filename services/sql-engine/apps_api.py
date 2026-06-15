"""应用市场：每租户已连接的应用（连接/断开/配置）。

- 应用目录在前端静态注册表（lib/apps.ts）；后端只管「连接状态」存 installed_apps。
- 路由前缀 /apps，经 nginx 暴露为 /api/apps/*。
"""
from __future__ import annotations

import json
from contextlib import contextmanager

import pymysql
from fastapi import APIRouter, Body, Query

from executor import MysqlOlapExecutor


class AppsService:
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

    def list(self, tenant_id: int) -> list[dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT app_key, status, config, updated_at FROM installed_apps WHERE tenant_id=%s",
                (tenant_id,),
            )
            rows = cur.fetchall()
        for r in rows:
            if isinstance(r.get("config"), str):
                try:
                    r["config"] = json.loads(r["config"])
                except (json.JSONDecodeError, TypeError):
                    r["config"] = None
            r["updated_at"] = str(r["updated_at"]) if r.get("updated_at") else None
        return rows

    def upsert(self, tenant_id: int, app_key: str, status: str, config: dict | None) -> dict:
        status = status if status in ("active", "inactive") else "active"
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """INSERT INTO installed_apps (tenant_id, app_key, status, config)
                   VALUES (%s,%s,%s,%s)
                   ON DUPLICATE KEY UPDATE status=VALUES(status), config=VALUES(config)""",
                (tenant_id, app_key, status, json.dumps(config, ensure_ascii=False) if config else None),
            )
        return {"app_key": app_key, "status": status}

    def remove(self, tenant_id: int, app_key: str) -> None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM installed_apps WHERE tenant_id=%s AND app_key=%s", (tenant_id, app_key))


service = AppsService()
router = APIRouter(prefix="/apps", tags=["apps"])


@router.get("")
def list_apps(tenant_id: int = Query(...)):
    return {"installed": service.list(tenant_id)}


@router.post("/{app_key}")
def upsert_app(app_key: str, tenant_id: int = Query(...), status: str = Query("active"),
               config: dict | None = Body(default=None)):
    return service.upsert(tenant_id, app_key, status, config)


@router.delete("/{app_key}")
def remove_app(app_key: str, tenant_id: int = Query(...)):
    service.remove(tenant_id, app_key)
    return {"ok": True}
