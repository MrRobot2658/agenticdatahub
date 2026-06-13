"""用户分组 CRUD"""

import json
from contextlib import contextmanager
from typing import Any

import pymysql

from executor import MysqlOlapExecutor


class GroupService:
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

    def create_group(self, data: dict) -> dict:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO user_groups (tenant_id, group_code, group_name, description, group_type, filter_rule)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        data["tenant_id"], data["group_code"], data["group_name"],
                        data.get("description"), data.get("group_type", "static"),
                        json.dumps(data.get("filter_rule") or {}, ensure_ascii=False),
                    ),
                )
                cur.execute("SELECT * FROM user_groups WHERE group_id = LAST_INSERT_ID()")
                return self._normalize(cur.fetchone())

    def list_groups(self, tenant_id: int) -> list[dict]:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT * FROM user_groups WHERE tenant_id=%s ORDER BY group_id",
                    (tenant_id,),
                )
                return [self._normalize(r) for r in cur.fetchall()]

    def get_group(self, tenant_id: int, group_id: int) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT * FROM user_groups WHERE tenant_id=%s AND group_id=%s",
                    (tenant_id, group_id),
                )
                row = cur.fetchone()
                return self._normalize(row) if row else None

    def get_group_by_code(self, tenant_id: int, group_code: str) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT * FROM user_groups WHERE tenant_id=%s AND group_code=%s",
                    (tenant_id, group_code),
                )
                row = cur.fetchone()
                return self._normalize(row) if row else None

    def add_member(self, tenant_id: int, group_id: int, one_id: int, source: str = "manual") -> dict:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO user_group_members (tenant_id, group_id, one_id, source)
                    VALUES (%s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE source=VALUES(source)
                    """,
                    (tenant_id, group_id, one_id, source),
                )
                cur.execute(
                    "UPDATE user_groups SET member_count = ("
                    "  SELECT COUNT(*) FROM user_group_members WHERE tenant_id=%s AND group_id=%s"
                    "), updated_at=NOW() WHERE tenant_id=%s AND group_id=%s",
                    (tenant_id, group_id, tenant_id, group_id),
                )
                cur.execute(
                    "SELECT * FROM user_group_members WHERE tenant_id=%s AND group_id=%s AND one_id=%s",
                    (tenant_id, group_id, one_id),
                )
                return cur.fetchone()

    def remove_member(self, tenant_id: int, group_id: int, one_id: int) -> bool:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM user_group_members WHERE tenant_id=%s AND group_id=%s AND one_id=%s",
                    (tenant_id, group_id, one_id),
                )
                deleted = cur.rowcount > 0
                if deleted:
                    cur.execute(
                        "UPDATE user_groups SET member_count = ("
                        "  SELECT COUNT(*) FROM user_group_members WHERE tenant_id=%s AND group_id=%s"
                        "), updated_at=NOW() WHERE tenant_id=%s AND group_id=%s",
                        (tenant_id, group_id, tenant_id, group_id),
                    )
                return deleted

    def list_members(self, tenant_id: int, group_id: int) -> list[dict]:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT m.*, w.phone, w.wechat_openid, w.tags, w.properties
                    FROM user_group_members m
                    LEFT JOIN doris_user_wide w ON m.tenant_id=w.tenant_id AND m.one_id=w.one_id
                    WHERE m.tenant_id=%s AND m.group_id=%s
                    ORDER BY m.added_at DESC
                    """,
                    (tenant_id, group_id),
                )
                return list(cur.fetchall())

    def user_groups(self, tenant_id: int, one_id: int) -> list[dict]:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT g.group_id, g.group_code, g.group_name, g.description, m.added_at, m.source
                    FROM user_group_members m
                    INNER JOIN user_groups g ON m.tenant_id=g.tenant_id AND m.group_id=g.group_id
                    WHERE m.tenant_id=%s AND m.one_id=%s
                    ORDER BY g.group_name
                    """,
                    (tenant_id, one_id),
                )
                return list(cur.fetchall())

    def get_user_summary(self, tenant_id: int, one_id: int) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT * FROM doris_user_wide WHERE tenant_id=%s AND one_id=%s",
                    (tenant_id, one_id),
                )
                wide = cur.fetchone()
                if not wide:
                    return None
                groups = self.user_groups(tenant_id, one_id)
                return {
                    **wide,
                    "groups": [g["group_code"] for g in groups],
                    "group_details": groups,
                }

    def search_members(
        self,
        tenant_id: int,
        group_ids: list[int],
        operator: str = "or",
        limit: int = 50,
    ) -> list[dict]:
        if not group_ids:
            return []
        operator = operator.lower()
        if operator not in ("and", "or"):
            operator = "or"
        limit = min(max(limit, 1), 200)

        placeholders = ",".join(["%s"] * len(group_ids))
        with self._conn() as conn:
            with conn.cursor() as cur:
                if operator == "and":
                    sql = f"""
                        SELECT w.one_id, w.phone, w.wechat_openid, w.tags, w.properties, w.update_time,
                               COUNT(DISTINCT m.group_id) AS matched_groups
                        FROM user_group_members m
                        INNER JOIN doris_user_wide w ON m.tenant_id=w.tenant_id AND m.one_id=w.one_id
                        WHERE m.tenant_id=%s AND m.group_id IN ({placeholders})
                        GROUP BY w.one_id, w.phone, w.wechat_openid, w.tags, w.properties, w.update_time
                        HAVING matched_groups = %s
                        ORDER BY w.update_time DESC
                        LIMIT %s
                    """
                    params = [tenant_id, *group_ids, len(group_ids), limit]
                else:
                    sql = f"""
                        SELECT DISTINCT w.one_id, w.phone, w.wechat_openid, w.tags, w.properties, w.update_time
                        FROM user_group_members m
                        INNER JOIN doris_user_wide w ON m.tenant_id=w.tenant_id AND m.one_id=w.one_id
                        WHERE m.tenant_id=%s AND m.group_id IN ({placeholders})
                        ORDER BY w.update_time DESC
                        LIMIT %s
                    """
                    params = [tenant_id, *group_ids, limit]
                cur.execute(sql, params)
                return [self._normalize(r) for r in cur.fetchall()]

    def _normalize(self, row: dict | None) -> dict | None:
        if not row:
            return None
        for k in ("filter_rule", "tags", "properties"):
            if k in row and isinstance(row[k], str):
                try:
                    row[k] = json.loads(row[k])
                except json.JSONDecodeError:
                    pass
        return row
