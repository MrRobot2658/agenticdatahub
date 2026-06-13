"""用户标签（多层级）"""

import json
from contextlib import contextmanager

import pymysql

from executor import MysqlOlapExecutor


class TagService:
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

    def get_tag(self, tenant_id: int, tag_id: int) -> dict | None:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT * FROM tag_definitions WHERE tenant_id=%s AND tag_id=%s",
                    (tenant_id, tag_id),
                )
                return cur.fetchone()

    def create_tag(self, data: dict) -> dict:
        tenant_id = data["tenant_id"]
        parent_id = data.get("parent_id")
        level = 1
        tag_path = data["tag_code"]
        if parent_id:
            parent = self.get_tag(tenant_id, parent_id)
            if not parent:
                raise ValueError(f"父标签不存在: {parent_id}")
            level = parent["level"] + 1
            tag_path = f"{parent['tag_path']}/{data['tag_code']}"

        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO tag_definitions
                        (tenant_id, parent_id, tag_code, tag_name, level, tag_path, description, sort_order)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        tenant_id, parent_id, data["tag_code"], data["tag_name"],
                        level, tag_path, data.get("description"), data.get("sort_order", 0),
                    ),
                )
                cur.execute("SELECT * FROM tag_definitions WHERE tag_id = LAST_INSERT_ID()")
                return cur.fetchone()

    def list_tags(self, tenant_id: int) -> list[dict]:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT tag_id, parent_id, tag_code, tag_name, level, tag_path,
                           description, sort_order, created_at
                    FROM tag_definitions
                    WHERE tenant_id=%s
                    ORDER BY sort_order, tag_id
                    """,
                    (tenant_id,),
                )
                return list(cur.fetchall())

    def get_tree(self, tenant_id: int) -> list[dict]:
        tags = self.list_tags(tenant_id)
        by_id = {t["tag_id"]: {**t, "children": []} for t in tags}
        roots = []
        for t in by_id.values():
            pid = t["parent_id"]
            if pid and pid in by_id:
                by_id[pid]["children"].append(t)
            else:
                roots.append(t)
        return roots

    def search_users(
        self,
        tenant_id: int,
        tag_codes: list[str],
        operator: str = "or",
        limit: int = 50,
    ) -> list[dict]:
        if not tag_codes:
            return []
        operator = operator.lower()
        if operator not in ("and", "or"):
            operator = "or"
        limit = min(max(limit, 1), 200)

        clauses = ["JSON_CONTAINS(tags, JSON_QUOTE(%s))" for _ in tag_codes]
        joiner = " AND " if operator == "and" else " OR "
        tag_expr = joiner.join(clauses)

        with self._conn() as conn:
            with conn.cursor() as cur:
                sql = f"""
                    SELECT one_id, phone, wechat_openid, wechat_unionid, form_id,
                           channel_count, tags, properties, update_time
                    FROM doris_user_wide
                    WHERE tenant_id=%s AND ({tag_expr})
                    ORDER BY update_time DESC
                    LIMIT %s
                """
                params = [tenant_id, *tag_codes, limit]
                cur.execute(sql, params)
                rows = cur.fetchall()
                return [self._normalize(r) for r in rows]

    def count_by_tag(self, tenant_id: int, tag_code: str) -> int:
        with self._conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COUNT(*) AS cnt FROM doris_user_wide
                    WHERE tenant_id=%s AND JSON_CONTAINS(tags, JSON_QUOTE(%s))
                    """,
                    (tenant_id, tag_code),
                )
                return int(cur.fetchone()["cnt"])

    def _normalize(self, row: dict) -> dict:
        for k in ("tags", "properties"):
            if k in row and isinstance(row[k], str):
                try:
                    row[k] = json.loads(row[k])
                except json.JSONDecodeError:
                    pass
        return row
