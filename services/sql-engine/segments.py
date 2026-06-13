"""Segment 规则保存（文档 Ch4：用户确认后保存候选 DSL）"""

import json
from contextlib import contextmanager

import pymysql

from executor import MysqlOlapExecutor


class SegmentService:
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

    def save(self, tenant_id: int, segment_code: str, segment_name: str,
             dsl: dict, estimate: int = 0, source: str = "manual") -> dict:
        base_object = dsl.get("object", "")
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO segments (tenant_id, segment_code, segment_name, base_object, dsl, estimate, source)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    segment_name=VALUES(segment_name), base_object=VALUES(base_object),
                    dsl=VALUES(dsl), estimate=VALUES(estimate), source=VALUES(source)
                """,
                (tenant_id, segment_code, segment_name, base_object,
                 json.dumps(dsl, ensure_ascii=False), estimate, source),
            )
            return self.get(tenant_id, segment_code)

    def list(self, tenant_id: int) -> list[dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM segments WHERE tenant_id=%s ORDER BY segment_id DESC", (tenant_id,))
            return [self._normalize(r) for r in cur.fetchall()]

    def get(self, tenant_id: int, segment_code: str) -> dict | None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM segments WHERE tenant_id=%s AND segment_code=%s",
                        (tenant_id, segment_code))
            row = cur.fetchone()
            return self._normalize(row) if row else None

    def _normalize(self, row: dict | None) -> dict | None:
        if row and isinstance(row.get("dsl"), str):
            try:
                row["dsl"] = json.loads(row["dsl"])
            except json.JSONDecodeError:
                pass
        return row
