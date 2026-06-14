"""对象管理 API（03-objects 模块）— 对象/字段/关系的元数据 CRUD + 单对象详情/一跳关联。

设计要点（对标 Twilio Segment 的 Object/Schema 管理，且严守项目铁律）：
- 仅做加法：不改 main.py / schemas.py / objects.py，复用 objects.ObjectService 与 OBJECT_REGISTRY。
- 所有数据查询参数化（%s）；DDL（CREATE/ALTER TABLE）无法参数化，故对所有标识符
  （object_key / table_name / pk / field_code）做严格白名单校验，杜绝注入。
- 全部操作带 tenant_id；多租户隔离。
- 自建对象/字段/关系写入 object_definitions / object_fields / relation_definitions /
  relation_properties，运行期与内置 OBJECT_REGISTRY 合并（见 /definitions）。
"""

import json
import re
from contextlib import contextmanager
from typing import Any

import pymysql
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from executor import MysqlOlapExecutor
from objects import OBJECT_REGISTRY, RELATION_MATRIX, ObjectService

router = APIRouter(prefix="/objects", tags=["objects"])

# ── 类型映射 ────────────────────────────────────────────────────────────────
# 逻辑字段类型（与 object_fields.field_type 枚举一致）→ 物理 MySQL 列类型
_SQL_TYPE: dict[str, str] = {
    "int": "BIGINT",
    "float": "DECIMAL(18,4)",
    "str": "VARCHAR(512)",
    "datetime": "DATETIME",
    "json": "JSON",
    "json_array": "JSON",
}
_FIELD_TYPES = set(_SQL_TYPE.keys())
_PROP_TYPES = {"int", "float", "str", "json", "datetime"}  # relation_properties.prop_type 枚举

# 合法标识符：小写字母开头，仅字母/数字/下划线，长度 ≤ 63（用于表名/列名/对象 key）
_IDENT_RE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
# 禁止覆盖的内置物理表前缀/系统表（额外保险）
_RESERVED_TABLES = {
    "object_relations", "object_definitions", "object_fields",
    "relation_definitions", "relation_properties", "doris_user_wide",
    "doris_id_mapping", "user_groups", "user_group_members",
}


class ObjectAdminError(ValueError):
    """对象管理领域错误（标识符非法 / 重复 / 类型不安全等）。"""


def _ident(name: str | None, what: str) -> str:
    if not isinstance(name, str) or not _IDENT_RE.match(name):
        raise ObjectAdminError(
            f"{what} 非法：{name!r}（须小写字母开头，仅含字母/数字/下划线，≤63 字符）"
        )
    return name


# ── Pydantic 模型（本文件内，避免改 schemas.py）─────────────────────────────
class FieldSpec(BaseModel):
    code: str
    type: str = "str"
    required: bool = False
    default: str | None = None
    label: str | None = None


class CreateObjectRequest(BaseModel):
    tenant_id: int
    object_key: str
    label: str | None = None
    table_name: str | None = None
    pk_field: str = "id"
    icon: str | None = None
    initial_fields: list[FieldSpec] = Field(default_factory=list)


class AddFieldRequest(BaseModel):
    field_code: str
    field_type: str = "str"
    is_required: bool = False
    default_value: str | None = None
    field_label: str | None = None


class PatchFieldRequest(BaseModel):
    field_label: str | None = None
    is_required: bool | None = None
    default_value: str | None = None
    is_active: bool | None = None
    field_type: str | None = None  # 仅用于检测：不允许物理改类型


class EdgePropertySpec(BaseModel):
    prop_key: str
    prop_type: str = "str"
    prop_label: str | None = None


class CreateRelationRequest(BaseModel):
    src_type: str
    rel_type: str
    dst_type: str
    relation_label: str | None = None
    edge_properties: list[EdgePropertySpec] = Field(default_factory=list)


# ── Service ─────────────────────────────────────────────────────────────────
class ObjectAdminService:
    def __init__(self, executor: MysqlOlapExecutor | None = None):
        self._executor = executor or MysqlOlapExecutor()
        self.config = self._executor.config
        self._objects = ObjectService(self._executor)  # 复用筛选/编译能力

    @contextmanager
    def _conn(self):
        conn = pymysql.connect(**self.config, autocommit=True)
        try:
            yield conn
        finally:
            conn.close()

    # ── 对象解析（内置 OBJECT_REGISTRY + 自建 object_definitions 合并）──────────
    def _resolve_object(self, tenant_id: int, object_key: str) -> dict:
        """返回 {table, pk, id_numeric, fields:{code:type}}；内置优先，自建查库。"""
        if object_key in OBJECT_REGISTRY:
            meta = OBJECT_REGISTRY[object_key]
            return {
                "table": meta["table"], "pk": meta["id"],
                "id_numeric": meta.get("id_numeric", False),
                "fields": dict(meta["fields"]),
            }
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT object_key, table_name, pk FROM object_definitions "
                "WHERE tenant_id=%s AND object_key=%s",
                (tenant_id, object_key),
            )
            row = cur.fetchone()
            if not row:
                raise ObjectAdminError(f"未知对象: {object_key}")
            cur.execute(
                "SELECT field_code, field_type FROM object_fields "
                "WHERE tenant_id=%s AND object_key=%s AND is_active=1",
                (tenant_id, object_key),
            )
            fields = {r["field_code"]: r["field_type"] for r in cur.fetchall()}
            return {
                "table": row["table_name"], "pk": row["pk"],
                "id_numeric": False, "fields": fields,
            }

    # ── 详情 ──────────────────────────────────────────────────────────────
    def get_detail(self, tenant_id: int, object_key: str, pk_value: str) -> dict | None:
        meta = self._resolve_object(tenant_id, object_key)
        table, pk = _ident(meta["table"], "表名"), _ident(meta["pk"], "主键")
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT * FROM `{table}` WHERE tenant_id=%s AND `{pk}`=%s LIMIT 1",
                (tenant_id, pk_value),
            )
            return self._normalize(cur.fetchone())

    def get_relations(self, tenant_id: int, object_key: str, pk_value: str) -> dict:
        """一跳关联：正向(本对象=src) + 反向(本对象=dst)，按 rel_type 分组并带回关联对象记录。"""
        out: dict[str, list[dict]] = {}
        with self._conn() as conn, conn.cursor() as cur:
            # 正向：本对象作为 src
            cur.execute(
                "SELECT rel_type, dst_type AS other_type, dst_id AS other_id, properties, create_time "
                "FROM object_relations WHERE tenant_id=%s AND src_type=%s AND src_id=%s",
                (tenant_id, object_key, str(pk_value)),
            )
            fwd = list(cur.fetchall())
            # 反向：本对象作为 dst
            cur.execute(
                "SELECT rel_type, src_type AS other_type, src_id AS other_id, properties, create_time "
                "FROM object_relations WHERE tenant_id=%s AND dst_type=%s AND dst_id=%s",
                (tenant_id, object_key, str(pk_value)),
            )
            rev = list(cur.fetchall())
        for edge in fwd:
            self._attach(tenant_id, out, edge, direction="forward")
        for edge in rev:
            self._attach(tenant_id, out, edge, direction="reverse")
        return out

    def _attach(self, tenant_id: int, out: dict, edge: dict, direction: str) -> None:
        rel_type = edge["rel_type"]
        other_type = edge["other_type"]
        try:
            related = self.get_detail(tenant_id, other_type, edge["other_id"])
        except ObjectAdminError:
            related = None
        item = {
            "object_key": other_type,
            "id": edge["other_id"],
            "direction": direction,
            "properties": self._json(edge.get("properties")),
            "create_time": edge.get("create_time"),
            "record": related,
        }
        out.setdefault(rel_type, []).append(item)

    # ── 创建对象（建物理表 + 写注册表）─────────────────────────────────────
    def create_object(self, body: CreateObjectRequest) -> dict:
        object_key = _ident(body.object_key, "object_key")
        table = _ident(body.table_name or f"object_{object_key}", "table_name")
        pk = _ident(body.pk_field or "id", "pk_field")
        if object_key in OBJECT_REGISTRY:
            raise ObjectAdminError(f"对象 {object_key} 为内置，已存在")
        if table in _RESERVED_TABLES:
            raise ObjectAdminError(f"表名 {table} 为系统保留，禁止占用")

        # 校验字段定义
        seen = {pk}
        col_defs: list[str] = []
        for f in body.initial_fields:
            code = _ident(f.code, "字段 code")
            if f.type not in _FIELD_TYPES:
                raise ObjectAdminError(f"字段 {code} 类型非法: {f.type}")
            if code in seen:
                raise ObjectAdminError(f"字段重复: {code}")
            seen.add(code)
            notnull = " NOT NULL" if f.required else ""
            col_defs.append(f"  `{code}` {_SQL_TYPE[f.type]}{notnull}")

        pk_sql_type = "VARCHAR(64)"
        ddl = (
            f"CREATE TABLE IF NOT EXISTS `{table}` (\n"
            f"  tenant_id BIGINT NOT NULL,\n"
            f"  `{pk}` {pk_sql_type} NOT NULL,\n"
            + ("".join(c + ",\n" for c in col_defs))
            + "  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n"
            + "  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,\n"
            + f"  PRIMARY KEY (tenant_id, `{pk}`)\n"
            + ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        )

        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM object_definitions WHERE tenant_id=%s AND object_key=%s",
                (body.tenant_id, object_key),
            )
            if cur.fetchone():
                raise ObjectAdminError(f"对象 {object_key} 已存在")
            cur.execute(ddl)
            cur.execute(
                "INSERT INTO object_definitions "
                "(tenant_id, object_key, label, table_name, pk, icon, is_builtin) "
                "VALUES (%s,%s,%s,%s,%s,%s,0)",
                (body.tenant_id, object_key, body.label or object_key, table, pk, body.icon),
            )
            for i, f in enumerate(body.initial_fields):
                cur.execute(
                    "INSERT INTO object_fields "
                    "(tenant_id, object_key, field_code, field_type, is_required, "
                    " default_value, field_label, is_active, sort_order) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,1,%s)",
                    (body.tenant_id, object_key, f.code, f.type, int(f.required),
                     f.default, f.label or f.code, i),
                )
        return {"ok": True, "object_key": object_key, "table_name": table,
                "message": f"对象 {object_key} 创建成功"}

    # ── 加字段（ALTER TABLE ADD COLUMN，纯加法安全）─────────────────────────
    def add_field(self, tenant_id: int, object_key: str, body: AddFieldRequest) -> dict:
        meta = self._resolve_object(tenant_id, object_key)
        if object_key not in {d["object_key"] for d in self._list_definitions(tenant_id)}:
            raise ObjectAdminError(f"对象 {object_key} 为内置或不存在，不支持加字段")
        table = _ident(meta["table"], "表名")
        code = _ident(body.field_code, "field_code")
        if body.field_type not in _FIELD_TYPES:
            raise ObjectAdminError(f"字段类型非法: {body.field_type}")
        if code in meta["fields"] or code == meta["pk"]:
            raise ObjectAdminError(f"字段已存在: {code}")
        notnull = " NOT NULL" if body.is_required else ""
        # ADD COLUMN 只扩展不收窄，类型安全
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"ALTER TABLE `{table}` ADD COLUMN `{code}` {_SQL_TYPE[body.field_type]}{notnull}"
            )
            cur.execute(
                "INSERT INTO object_fields "
                "(tenant_id, object_key, field_code, field_type, is_required, "
                " default_value, field_label, is_active) VALUES (%s,%s,%s,%s,%s,%s,%s,1)",
                (tenant_id, object_key, code, body.field_type, int(body.is_required),
                 body.default_value, body.field_label or code),
            )
        return {"ok": True, "field_code": code, "message": f"字段 {code} 已添加"}

    # ── 改字段元数据 / 软删（绝不物理改类型）─────────────────────────────────
    def patch_field(self, tenant_id: int, object_key: str, field_code: str,
                    body: PatchFieldRequest) -> dict:
        if body.field_type is not None:
            with self._conn() as conn, conn.cursor() as cur:
                cur.execute(
                    "SELECT field_type FROM object_fields "
                    "WHERE tenant_id=%s AND object_key=%s AND field_code=%s",
                    (tenant_id, object_key, field_code),
                )
                cur_row = cur.fetchone()
            if cur_row and cur_row["field_type"] != body.field_type:
                raise ObjectAdminError("禁止物理改字段类型（可能导致数据收窄/丢失）；请新增字段")
        sets, vals = [], []
        if body.field_label is not None:
            sets.append("field_label=%s"); vals.append(body.field_label)
        if body.is_required is not None:
            sets.append("is_required=%s"); vals.append(int(body.is_required))
        if body.default_value is not None:
            sets.append("default_value=%s"); vals.append(body.default_value)
        if body.is_active is not None:
            sets.append("is_active=%s"); vals.append(int(body.is_active))
        if not sets:
            raise ObjectAdminError("无可更新字段")
        vals.extend([tenant_id, object_key, field_code])
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"UPDATE object_fields SET {', '.join(sets)} "
                "WHERE tenant_id=%s AND object_key=%s AND field_code=%s",
                vals,
            )
            if cur.rowcount == 0:
                raise ObjectAdminError(f"字段不存在: {field_code}")
        return {"ok": True, "field_code": field_code}

    # ── 关系声明 ───────────────────────────────────────────────────────────
    def create_relation(self, tenant_id: int, body: CreateRelationRequest) -> dict:
        src = _ident(body.src_type, "src_type")
        rel = _ident(body.rel_type, "rel_type")
        dst = _ident(body.dst_type, "dst_type")
        # src/dst 必须是已知对象（内置或自建）
        known = set(OBJECT_REGISTRY) | {d["object_key"] for d in self._list_definitions(tenant_id)}
        for t in (src, dst):
            if t not in known:
                raise ObjectAdminError(f"对象类型不存在: {t}")
        if (src, rel, dst) in RELATION_MATRIX:
            raise ObjectAdminError(f"关系为内置，已存在: {src}-{rel}->{dst}")
        for p in body.edge_properties:
            _ident(p.prop_key, "prop_key")
            if p.prop_type not in _PROP_TYPES:
                raise ObjectAdminError(f"边属性类型非法: {p.prop_type}")
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM relation_definitions "
                "WHERE tenant_id=%s AND src_type=%s AND rel_type=%s AND dst_type=%s",
                (tenant_id, src, rel, dst),
            )
            if cur.fetchone():
                raise ObjectAdminError(f"关系已存在: {src}-{rel}->{dst}")
            cur.execute(
                "INSERT INTO relation_definitions "
                "(tenant_id, src_type, rel_type, dst_type, relation_label, is_builtin) "
                "VALUES (%s,%s,%s,%s,%s,0)",
                (tenant_id, src, rel, dst, body.relation_label),
            )
            for i, p in enumerate(body.edge_properties):
                cur.execute(
                    "INSERT INTO relation_properties "
                    "(tenant_id, src_type, rel_type, dst_type, prop_key, prop_type, prop_label, sort_order) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                    (tenant_id, src, rel, dst, p.prop_key, p.prop_type, p.prop_label, i),
                )
        return {"ok": True, "src_type": src, "rel_type": rel, "dst_type": dst}

    def delete_relation(self, tenant_id: int, src: str, rel: str, dst: str) -> dict:
        if (src, rel, dst) in RELATION_MATRIX:
            raise ObjectAdminError(f"内置关系禁止删除: {src}-{rel}->{dst}")
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT is_builtin FROM relation_definitions "
                "WHERE tenant_id=%s AND src_type=%s AND rel_type=%s AND dst_type=%s",
                (tenant_id, src, rel, dst),
            )
            row = cur.fetchone()
            if not row:
                raise ObjectAdminError(f"关系不存在: {src}-{rel}->{dst}")
            if row["is_builtin"]:
                raise ObjectAdminError(f"内置关系禁止删除: {src}-{rel}->{dst}")
            cur.execute(
                "DELETE FROM relation_properties "
                "WHERE tenant_id=%s AND src_type=%s AND rel_type=%s AND dst_type=%s",
                (tenant_id, src, rel, dst),
            )
            cur.execute(
                "DELETE FROM relation_definitions "
                "WHERE tenant_id=%s AND src_type=%s AND rel_type=%s AND dst_type=%s",
                (tenant_id, src, rel, dst),
            )
        return {"ok": True}

    # ── 定义清单（供运行期与内置 OBJECT_REGISTRY 合并）──────────────────────
    def _list_definitions(self, tenant_id: int) -> list[dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT object_key, label, table_name, pk, icon, is_builtin, sort_order "
                "FROM object_definitions WHERE tenant_id=%s ORDER BY sort_order, object_key",
                (tenant_id,),
            )
            return list(cur.fetchall())

    def list_definitions(self, tenant_id: int) -> list[dict]:
        out = []
        with self._conn() as conn, conn.cursor() as cur:
            for d in self._list_definitions(tenant_id):
                cur.execute(
                    "SELECT field_code, field_type, is_required, default_value, field_label "
                    "FROM object_fields WHERE tenant_id=%s AND object_key=%s AND is_active=1 "
                    "ORDER BY sort_order, field_code",
                    (tenant_id, d["object_key"]),
                )
                fields = [
                    {"code": r["field_code"], "type": r["field_type"],
                     "required": bool(r["is_required"]), "default": r["default_value"],
                     "label": r["field_label"]}
                    for r in cur.fetchall()
                ]
                out.append({
                    "object_key": d["object_key"], "label": d["label"],
                    "table_name": d["table_name"], "pk": d["pk"], "icon": d["icon"],
                    "is_builtin": bool(d["is_builtin"]), "fields": fields,
                })
        return out

    # ── helpers ───────────────────────────────────────────────────────────
    def _json(self, v: Any) -> Any:
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, TypeError):
                return v
        return v

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


_svc = ObjectAdminService()


def _wrap(fn, *args):
    try:
        return fn(*args)
    except ObjectAdminError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Routes ──────────────────────────────────────────────────────────────────
@router.get("/{tenant_id}/definitions", summary="加载租户对象定义（供 OBJECT_REGISTRY 合并）")
def list_definitions(tenant_id: int):
    return {"tenant_id": tenant_id, "definitions": _wrap(_svc.list_definitions, tenant_id)}


@router.post("/create", summary="创建新对象类型（建物理表 + 写注册表）")
def create_object(body: CreateObjectRequest):
    return _wrap(_svc.create_object, body)


@router.post("/{tenant_id}/relations", summary="声明新关系类型")
def create_relation(tenant_id: int, body: CreateRelationRequest):
    return _wrap(_svc.create_relation, tenant_id, body)


@router.delete("/{tenant_id}/relations/{src_type}/{rel_type}/{dst_type}",
               summary="删除关系定义（内置禁删）")
def delete_relation(tenant_id: int, src_type: str, rel_type: str, dst_type: str):
    return _wrap(_svc.delete_relation, tenant_id, src_type, rel_type, dst_type)


@router.post("/{tenant_id}/{object_key}/fields", summary="为对象新增字段")
def add_field(tenant_id: int, object_key: str, body: AddFieldRequest):
    return _wrap(_svc.add_field, tenant_id, object_key, body)


@router.patch("/{tenant_id}/{object_key}/fields/{field_code}",
              summary="编辑字段元数据 / 软删除")
def patch_field(tenant_id: int, object_key: str, field_code: str, body: PatchFieldRequest):
    return _wrap(_svc.patch_field, tenant_id, object_key, field_code, body)


@router.get("/{tenant_id}/{object_key}/{pk_value}/relations", summary="一跳关联对象")
def object_relations(tenant_id: int, object_key: str, pk_value: str):
    return {
        "tenant_id": tenant_id, "object_key": object_key, "id": pk_value,
        "relations": _wrap(_svc.get_relations, tenant_id, object_key, pk_value),
    }


@router.get("/{tenant_id}/{object_key}/{pk_value}", summary="单对象详情")
def object_detail(tenant_id: int, object_key: str, pk_value: str):
    rec = _wrap(_svc.get_detail, tenant_id, object_key, pk_value)
    if rec is None:
        raise HTTPException(status_code=404, detail=f"未找到 {object_key}:{pk_value}")
    return rec
