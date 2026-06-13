"""多对象接入与跨对象筛选（文档 V3.0-06 第 3 章）

- 对象：User / Lead / Account / Product / Store，关联统一存 object_relations。
- 跨对象筛选：base 对象条件 + relation 条件（经 object_relations JOIN），硬约束 ≤ 3 跳。
- 字段/操作符白名单校验：拒绝不存在字段、非法操作符（为 S2 DSL 校验打底）。
"""

import json
from contextlib import contextmanager
from typing import Any

import pymysql

from executor import MysqlOlapExecutor

MAX_HOPS = 3  # 文档 H2：实时 JOIN 最大 ≤ 3 跳，超跳拒绝

# 对象注册表：object_type → 表 / 主键 / 字段类型
OBJECT_REGISTRY: dict[str, dict] = {
    "user": {
        "table": "doris_user_wide", "id": "one_id", "id_numeric": True,
        "fields": {"one_id": "int", "phone": "str", "tags": "json_array",
                   "channel_count": "int", "properties": "json"},
    },
    "lead": {
        "table": "object_lead", "id": "lead_id", "id_numeric": False,
        "fields": {"lead_id": "str", "lead_name": "str", "city": "str",
                   "company_size": "int", "source": "str", "stage": "str"},
    },
    "account": {
        "table": "object_account", "id": "account_id", "id_numeric": False,
        "fields": {"account_id": "str", "name": "str", "industry": "str", "scale": "str"},
    },
    "product": {
        "table": "object_product", "id": "product_id", "id_numeric": False,
        "fields": {"product_id": "str", "sku": "str", "category": "str", "price": "float"},
    },
    "store": {
        "table": "object_store", "id": "store_id", "id_numeric": False,
        "fields": {"store_id": "str", "store_name": "str", "region": "str", "address": "str"},
    },
}

# 操作符白名单 → SQL 片段构造器
SCALAR_OPS = {
    "eq": "=", "ne": "!=", "gt": ">", "ge": ">=", "lt": "<", "le": "<=", "like": "LIKE",
}
LIST_OPS = {"in": "IN", "not_in": "NOT IN"}

# 已定义的关联（文档图 6 矩阵）：(src_type, rel_type, dst_type)
RELATION_MATRIX = {
    ("lead", "belongs_to", "user"),
    ("user", "owns", "account"),
    ("account", "purchased", "product"),
    ("user", "visited", "store"),
}

# 关系边(object_relations.properties JSON)上的已知键：喂给 NL/schema，避免 LLM 编造键名。
# 边条件统一可用 create_time(关系发生时间，所有关系都有)，外加下表声明的 properties.<key>。
RELATION_PROPERTIES: dict[tuple, dict] = {
    ("account", "purchased", "product"): {
        "channel": {"type": "str", "label": "购买渠道，如 app/web/store"},
        "amount": {"type": "float", "label": "订单金额"},
        "quantity": {"type": "int", "label": "购买数量"},
        "order_id": {"type": "str", "label": "订单号"},
    },
    ("user", "visited", "store"): {
        "channel": {"type": "str", "label": "到访渠道，如 app/mini/offline"},
        "duration": {"type": "int", "label": "停留时长(秒)"},
    },
}


class ObjectError(ValueError):
    """对象筛选/校验错误（字段不存在、超跳、非法操作符等）"""


class ObjectService:
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

    # ── 元数据 ────────────────────────────────────────────────────────────
    def list_objects(self) -> list[dict]:
        out = []
        for otype, meta in OBJECT_REGISTRY.items():
            out.append({
                "object": otype, "table": meta["table"], "id": meta["id"],
                "fields": [{"code": f, "type": t} for f, t in meta["fields"].items()],
            })
        return out

    def relations(self) -> list[dict]:
        out = []
        for (s, r, d) in sorted(RELATION_MATRIX):
            # 每个关系的可用边字段：create_time（通用）+ 声明的 properties.<key>
            edge_fields = {"create_time": {"type": "datetime", "label": "关系发生时间"}}
            for key, spec in RELATION_PROPERTIES.get((s, r, d), {}).items():
                edge_fields[f"properties.{key}"] = spec
            out.append({"src_type": s, "rel_type": r, "dst_type": d, "edge_fields": edge_fields})
        return out

    # ── 接入：单对象 upsert ───────────────────────────────────────────────
    def upsert_object(self, tenant_id: int, object_type: str, record: dict) -> dict:
        meta = self._meta(object_type)
        id_field = meta["id"]
        if id_field not in record:
            raise ObjectError(f"缺少主键字段: {id_field}")
        cols, vals, placeholders, updates = ["tenant_id"], [tenant_id], ["%s"], []
        for f, v in record.items():
            if f not in meta["fields"] and f != "properties":
                raise ObjectError(f"对象 {object_type} 无字段: {f}")
            cols.append(f)
            vals.append(json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v)
            placeholders.append("%s")
            if f != id_field:
                updates.append(f"{f}=VALUES({f})")
        sql = (f"INSERT INTO {meta['table']} ({', '.join(cols)}) VALUES ({', '.join(placeholders)})"
               + (f" ON DUPLICATE KEY UPDATE {', '.join(updates)}" if updates else ""))
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, vals)
        return {"object": object_type, "id": record[id_field], "ok": True}

    def add_relation(self, tenant_id: int, src_type: str, src_id: str,
                     rel_type: str, dst_type: str, dst_id: str) -> dict:
        if (src_type, rel_type, dst_type) not in RELATION_MATRIX:
            raise ObjectError(f"未定义的关联: {src_type}-{rel_type}->{dst_type}")
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT IGNORE INTO object_relations "
                "(tenant_id, src_type, src_id, rel_type, dst_type, dst_id) VALUES (%s,%s,%s,%s,%s,%s)",
                (tenant_id, src_type, str(src_id), rel_type, dst_type, str(dst_id)),
            )
        return {"src": [src_type, src_id], "rel": rel_type, "dst": [dst_type, dst_id], "ok": True}

    # ── 跨对象筛选 ────────────────────────────────────────────────────────
    def search(self, tenant_id: int, object_type: str, conditions: list[dict] | None,
               relations: list[dict] | None, limit: int = 50, count_only: bool = False,
               logic: str = "AND") -> dict:
        sql, params = self.build_sql(tenant_id, object_type, conditions, relations, limit, count_only, logic)
        import time
        start = time.perf_counter()
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            rows = list(cur.fetchall())
        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        if count_only:
            return {"object": object_type, "estimate": rows[0]["cnt"], "elapsed_ms": elapsed_ms, "sql": sql}
        return {
            "object": object_type, "row_count": len(rows), "elapsed_ms": elapsed_ms,
            "sql": sql, "data": [self._normalize(r) for r in rows],
        }

    def build_sql(self, tenant_id: int, object_type: str, conditions: list[dict] | None,
                  relations: list[dict] | None, limit: int = 50,
                  count_only: bool = False, logic: str = "AND") -> tuple[str, dict]:
        """把对象筛选编译为 SQL（不执行）。S2 DSL 编译器复用此方法。

        conditions 支持嵌套逻辑组：叶子 {field,op,value} 或组 {logic:'AND'|'OR', conditions:[...]}。
        """
        base = self._meta(object_type)
        relations = relations or []
        total_hops = _count_hops(relations)  # 整棵关系树的总跳数（含链式嵌套）
        if total_hops > MAX_HOPS:
            raise ObjectError(f"跨对象 JOIN 超过 {MAX_HOPS} 跳上限（请求 {total_hops} 跳），已拒绝（文档 H2）")

        params: dict[str, Any] = {"tenant_id": tenant_id}
        where = ["t0.tenant_id = %(tenant_id)s"]
        joins: list[str] = []
        pc = _Counter()

        # base 对象自身条件（支持 AND/OR 嵌套）
        base_cond = self._conditions_sql(object_type, "t0", conditions, logic, params, pc)
        if base_cond:
            where.append(f"({base_cond})")

        # relation 条件（递归展开关系树，支持链式多跳：每跳 target 成为下一跳锚点）
        self._build_relations(object_type, "t0", base, relations, where, joins, params, pc, [0])

        select = "COUNT(DISTINCT t0." + base["id"] + ") AS cnt" if count_only else f"DISTINCT t0.*"
        sql = f"SELECT {select} FROM {base['table']} t0 " + " ".join(joins) + " WHERE " + " AND ".join(where)
        if not count_only:
            params["_limit"] = min(max(int(limit), 1), 1000)
            sql += " LIMIT %(_limit)s"
        return sql, params

    def _build_relations(self, parent_type: str, parent_alias: str, parent_meta: dict,
                         relations: list[dict] | None, where: list[str], joins: list[str],
                         params: dict, pc: "_Counter", idx: list[int]) -> None:
        """递归展开关系树。每个关系都锚定在其父对象别名上；嵌套关系以当前 target 为新锚点，
        从而支持 user→account→product 这类链式多跳。idx 为可变跳序号，保证别名全局唯一。"""
        for rel in (relations or []):
            idx[0] += 1
            i = idx[0]
            rel_type = rel.get("rel_type")
            tgt_type = rel.get("object")
            direction = rel.get("direction", "forward")
            tgt = self._meta(tgt_type)
            self._check_relation(parent_type, rel_type, tgt_type, direction)

            ra, ua = f"r{i}", f"u{i}"
            parent_idexpr = self._id_expr(parent_alias, parent_meta)
            pr = f"rel_{i}"
            params[pr] = rel_type
            if direction == "forward":  # parent=src, target=dst
                joins.append(
                    f"JOIN object_relations {ra} ON {ra}.tenant_id=t0.tenant_id "
                    f"AND {ra}.rel_type=%({pr})s AND {ra}.src_type=%(o_{ra}s)s AND {ra}.src_id={parent_idexpr} "
                    f"AND {ra}.dst_type=%(o_{ra}d)s"
                )
                params[f"o_{ra}s"], params[f"o_{ra}d"] = parent_type, tgt_type
                joins.append(f"JOIN {tgt['table']} {ua} ON {ua}.tenant_id=t0.tenant_id AND {ua}.{tgt['id']}={self._cast_id(ra, 'dst_id', tgt)}")
            else:  # reverse: parent=dst, target=src（如"查门店全部访客"）
                joins.append(
                    f"JOIN object_relations {ra} ON {ra}.tenant_id=t0.tenant_id "
                    f"AND {ra}.rel_type=%({pr})s AND {ra}.dst_type=%(o_{ra}d)s AND {ra}.dst_id={parent_idexpr} "
                    f"AND {ra}.src_type=%(o_{ra}s)s"
                )
                params[f"o_{ra}s"], params[f"o_{ra}d"] = tgt_type, parent_type
                joins.append(f"JOIN {tgt['table']} {ua} ON {ua}.tenant_id=t0.tenant_id AND {ua}.{tgt['id']}={self._cast_id(ra, 'src_id', tgt)}")

            rel_cond = self._conditions_sql(tgt_type, ua, rel.get("conditions"), rel.get("logic", "AND"), params, pc)
            if rel_cond:
                where.append(f"({rel_cond})")

            # 边条件：作用在关系行 ra(object_relations) 上，如"购买时间最近30天"
            edge_cond = self._edge_conditions_sql(ra, rel.get("edge_conditions"),
                                                  rel.get("edge_logic", "AND"), params, pc)
            if edge_cond:
                where.append(f"({edge_cond})")

            # 递归下一跳：当前 target 成为锚点
            self._build_relations(tgt_type, ua, tgt, rel.get("relations"), where, joins, params, pc, idx)

    # ── 内部 ──────────────────────────────────────────────────────────────
    def _meta(self, object_type: str) -> dict:
        if object_type not in OBJECT_REGISTRY:
            raise ObjectError(f"未知对象类型: {object_type}")
        return OBJECT_REGISTRY[object_type]

    def _check_relation(self, base: str, rel_type: str, tgt: str, direction: str):
        edge = (base, rel_type, tgt) if direction == "forward" else (tgt, rel_type, base)
        if edge not in RELATION_MATRIX:
            raise ObjectError(f"未定义的关联({direction}): {base}-{rel_type}->{tgt}")

    def _id_expr(self, alias: str, meta: dict) -> str:
        # object_relations.src_id/dst_id 是 VARCHAR；user 主键是数值，需转字符比较
        col = f"{alias}.{meta['id']}"
        return f"CAST({col} AS CHAR)" if meta["id_numeric"] else col

    def _cast_id(self, rel_alias: str, side_col: str, tgt: dict) -> str:
        ref = f"{rel_alias}.{side_col}"
        return f"CAST({ref} AS UNSIGNED)" if tgt["id_numeric"] else ref

    def _conditions_sql(self, object_type: str, alias: str, items: list[dict] | None,
                        logic: str, params: dict, pc: "_Counter") -> str:
        """组合条件列表（叶子或嵌套组）为 SQL，支持 AND/OR。"""
        parts: list[str] = []
        for it in (items or []):
            is_group = "field" not in it and ("conditions" in it or "logic" in it)
            if is_group:
                sub = self._conditions_sql(object_type, alias, it.get("conditions"),
                                           it.get("logic", "AND"), params, pc)
                if sub:
                    parts.append(f"({sub})")
            else:
                parts.append(self._cond_sql(object_type, alias, it, params, pc))
        joiner = " OR " if str(logic).upper() == "OR" else " AND "
        return joiner.join(parts)

    def _cond_sql(self, object_type: str, alias: str, cond: dict, params: dict, pc: "_Counter") -> str:
        meta = self._meta(object_type)
        field = cond.get("field")
        op = cond.get("op")
        val = cond.get("value")
        if field not in meta["fields"]:
            raise ObjectError(f"对象 {object_type} 无字段: {field}")
        ftype = meta["fields"][field]
        col = f"{alias}.{field}"

        if ftype == "json_array":
            if op not in ("contains",):
                raise ObjectError(f"字段 {field} 仅支持 contains 操作符")
            p = pc.next()
            params[p] = val
            return f"JSON_CONTAINS({col}, JSON_QUOTE(%({p})s))"
        if op in SCALAR_OPS:
            p = pc.next()
            params[p] = val
            return f"{col} {SCALAR_OPS[op]} %({p})s"
        if op in LIST_OPS:
            if not isinstance(val, (list, tuple)) or not val:
                raise ObjectError(f"操作符 {op} 需要非空列表")
            names = []
            for v in val:
                p = pc.next()
                params[p] = v
                names.append(f"%({p})s")
            return f"{col} {LIST_OPS[op]} ({', '.join(names)})"
        if op == "between":
            if not isinstance(val, (list, tuple)) or len(val) != 2:
                raise ObjectError("between 需要 [lo, hi]")
            p1, p2 = pc.next(), pc.next()
            params[p1], params[p2] = val[0], val[1]
            return f"{col} BETWEEN %({p1})s AND %({p2})s"
        raise ObjectError(f"不支持的操作符: {op}")

    # ── 边条件（作用在 object_relations 行上）────────────────────────────────
    def _edge_conditions_sql(self, rel_alias: str, items: list[dict] | None,
                             logic: str, params: dict, pc: "_Counter") -> str:
        """组合边条件（叶子或嵌套组）为 SQL，支持 AND/OR。字段限 create_time / properties.<key>。"""
        parts: list[str] = []
        for it in (items or []):
            is_group = "field" not in it and ("conditions" in it or "logic" in it)
            if is_group:
                sub = self._edge_conditions_sql(rel_alias, it.get("conditions"),
                                                it.get("logic", "AND"), params, pc)
                if sub:
                    parts.append(f"({sub})")
            else:
                parts.append(self._edge_cond_sql(rel_alias, it, params, pc))
        joiner = " OR " if str(logic).upper() == "OR" else " AND "
        return joiner.join(parts)

    def _edge_col(self, rel_alias: str, field: str | None) -> str:
        """把边字段解析为 SQL 列表达式。仅允许 create_time 与 properties.<key>（白名单防注入）。"""
        if field == "create_time":
            return f"{rel_alias}.create_time"
        if isinstance(field, str) and field.startswith("properties."):
            key = field[len("properties."):]
            if not key or not all(c.isalnum() or c == "_" for c in key):
                raise ObjectError(f"非法 properties 路径: {field}")
            return f"JSON_UNQUOTE(JSON_EXTRACT({rel_alias}.properties, '$.{key}'))"
        raise ObjectError(f"未知边字段: {field}（仅支持 create_time / properties.<key>）")

    def _edge_cond_sql(self, rel_alias: str, cond: dict, params: dict, pc: "_Counter") -> str:
        col = self._edge_col(rel_alias, cond.get("field"))
        op = cond.get("op")
        val = cond.get("value")
        if op in SCALAR_OPS:
            p = pc.next()
            params[p] = val
            return f"{col} {SCALAR_OPS[op]} %({p})s"
        if op in LIST_OPS:
            if not isinstance(val, (list, tuple)) or not val:
                raise ObjectError(f"操作符 {op} 需要非空列表")
            names = []
            for v in val:
                p = pc.next()
                params[p] = v
                names.append(f"%({p})s")
            return f"{col} {LIST_OPS[op]} ({', '.join(names)})"
        if op == "between":
            if not isinstance(val, (list, tuple)) or len(val) != 2:
                raise ObjectError("between 需要 [lo, hi]")
            p1, p2 = pc.next(), pc.next()
            params[p1], params[p2] = val[0], val[1]
            return f"{col} BETWEEN %({p1})s AND %({p2})s"
        raise ObjectError(f"边条件不支持的操作符: {op}")

    def _normalize(self, row: dict | None) -> dict | None:
        if not row:
            return None
        for k in ("tags", "properties"):
            if k in row and isinstance(row[k], str):
                try:
                    row[k] = json.loads(row[k])
                except json.JSONDecodeError:
                    pass
        return row


def _count_hops(relations: list[dict] | None) -> int:
    """统计关系树的总跳数（每个关系算 1 跳，含链式嵌套）。"""
    total = 0
    for rel in (relations or []):
        total += 1 + _count_hops(rel.get("relations"))
    return total


class _Counter:
    def __init__(self):
        self.i = 0

    def next(self) -> str:
        self.i += 1
        return f"p{self.i}"
