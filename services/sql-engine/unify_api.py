"""02 · unify 模块 API（对标 Twilio Segment 的 Unify / Identity / Computed Traits）

只做加法：本文件自带 APIRouter（变量名 router，prefix=/unify），自带 Pydantic 模型与
service 类，不修改 main.py / schemas.py / 既有 service。复用既有 ObjectService 的
build_sql/search（validate→compile 路径）做圈人，绝不手拼业务筛选 SQL；所有写表均参数化，
且全部按 tenant_id 隔离。

覆盖能力：
- 身份解析规则 identity_resolution_rules（优先级 / merge 策略 / 唯一性）
- 任意对象打标 object_tags（source = manual/computed/imported）
- 泛对象群组 user_groups + object_group_members（动态群组刷新）
- SQL 特征 sql_trait_definitions / sql_trait_results（定义 + 执行落库）
- 预测模型 prediction_models（配置 + 推理写入宽表 properties）
- 档案回流 connections_reverse_etl_jobs / runs（配置 + 执行一次）
- 泛对象搜索（在 ObjectService 之上叠加 object_tags 标签过滤）
"""

import json
import re
import time
import uuid
from contextlib import contextmanager
from typing import Any

import pymysql
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from executor import MysqlOlapExecutor
from objects import OBJECT_REGISTRY, ObjectError, ObjectService

router = APIRouter(prefix="/unify", tags=["unify"])


# ── Pydantic 模型（仅本文件，勿写进 schemas.py）──────────────────────────────

class IdentityRuleIn(BaseModel):
    rule_id: str | None = Field(None, description="留空则按 identifier_type 自动生成")
    identifier_type: str = Field(..., description="如 wechat_openid/phone/email/device")
    priority: int = 50
    max_per_profile: int | None = None
    is_unique: bool = False
    is_primary: bool = False
    merge_strategy: str | None = Field(None, description="take_min/take_max/latest")
    description: str | None = None
    enabled: bool = True


class TagAssignIn(BaseModel):
    object_type: str
    object_id: str
    source: str = Field("manual", description="manual/computed/imported")
    assigned_by: str | None = None


class SqlTraitIn(BaseModel):
    trait_code: str
    trait_name: str | None = None
    sql_query: str = Field(..., description="单条 SELECT，需含 tenant_id 过滤，返回 object_id/trait_value[/object_type]")
    warehouse_type: str = "mysql"
    warehouse_id: str | None = None
    schedule_type: str = "manual"
    schedule_cron: str | None = None
    result_table: str | None = None
    object_type: str = "user"
    enabled: bool = True


class SqlTraitExecuteIn(BaseModel):
    trait_id: str | None = Field(None, description="留空执行该租户全部 enabled 特征")


class PredictionModelIn(BaseModel):
    model_id: str | None = None
    model_name: str
    model_type: str = Field(..., description="purchase/churn/ltv")
    target_event: str | None = None
    features: list[str] = Field(default_factory=list)
    training_data_days: int | None = None
    inference_horizon: str | None = None
    enabled: bool = True


class ProfileSyncIn(BaseModel):
    job_id: str | None = None
    job_name: str | None = None
    target_warehouse: str = Field(..., description="目标数仓标识 / warehouse_id")
    source_object: str = Field("doris_user_wide", description="回流的源对象表")
    tables: list[str] = Field(default_factory=list, description="要同步的特征/标签表")
    schedule: str | None = Field(None, description="cron，如 0 */15 * * * *")


class UnifyObjectSearchIn(BaseModel):
    tenant_id: int
    object: str
    conditions: list[dict] = Field(default_factory=list)
    relations: list[dict] = Field(default_factory=list)
    tag_codes: list[str] = Field(default_factory=list, description="object_tags 标签过滤")
    tag_logic: str = Field("or", description="and/or")
    logic: str = "AND"
    limit: int = 50
    count_only: bool = False


# ── Service ────────────────────────────────────────────────────────────────

def _gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _safe_key(raw: str) -> str:
    """把任意字符串收敛为 [0-9A-Za-z_]，用于 JSON_SET 路径键，防注入。"""
    key = re.sub(r"[^0-9A-Za-z_]", "_", raw or "").strip("_")
    return key or "model"


class UnifyService:
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
    def _loads(row: dict | None, keys: tuple[str, ...]) -> dict | None:
        if not row:
            return row
        for k in keys:
            if k in row and isinstance(row[k], str):
                try:
                    row[k] = json.loads(row[k])
                except (json.JSONDecodeError, TypeError):
                    pass
        return row

    # ── 身份解析规则 ─────────────────────────────────────────────────────
    def list_identity_rules(self, tenant_id: int) -> list[dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM identity_resolution_rules WHERE tenant_id=%s "
                "ORDER BY priority ASC, rule_id ASC",
                (tenant_id,),
            )
            return list(cur.fetchall())

    def upsert_identity_rule(self, tenant_id: int, data: dict) -> dict:
        rule_id = data.get("rule_id") or f"rule_{data['identifier_type']}"
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO identity_resolution_rules
                    (tenant_id, rule_id, identifier_type, priority, max_per_profile,
                     is_unique, is_primary, merge_strategy, description, enabled)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    identifier_type=VALUES(identifier_type), priority=VALUES(priority),
                    max_per_profile=VALUES(max_per_profile), is_unique=VALUES(is_unique),
                    is_primary=VALUES(is_primary), merge_strategy=VALUES(merge_strategy),
                    description=VALUES(description), enabled=VALUES(enabled)
                """,
                (
                    tenant_id, rule_id, data["identifier_type"], data.get("priority", 50),
                    data.get("max_per_profile"), int(bool(data.get("is_unique"))),
                    int(bool(data.get("is_primary"))), data.get("merge_strategy"),
                    data.get("description"), int(bool(data.get("enabled", True))),
                ),
            )
            cur.execute(
                "SELECT * FROM identity_resolution_rules WHERE tenant_id=%s AND rule_id=%s",
                (tenant_id, rule_id),
            )
            return cur.fetchone()

    def delete_identity_rule(self, tenant_id: int, rule_id: str) -> bool:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM identity_resolution_rules WHERE tenant_id=%s AND rule_id=%s",
                (tenant_id, rule_id),
            )
            return cur.rowcount > 0

    # ── 任意对象打标 ─────────────────────────────────────────────────────
    def assign_tag(self, tenant_id: int, tag_code: str, data: dict) -> dict:
        otype = data["object_type"]
        if otype not in OBJECT_REGISTRY:
            raise ObjectError(f"未知对象类型: {otype}")
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO object_tags
                    (tenant_id, object_type, object_id, tag_code, source, assigned_by)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    source=VALUES(source), assigned_by=VALUES(assigned_by),
                    assigned_at=CURRENT_TIMESTAMP
                """,
                (
                    tenant_id, otype, str(data["object_id"]), tag_code,
                    data.get("source", "manual"), data.get("assigned_by"),
                ),
            )
            cur.execute(
                "SELECT * FROM object_tags WHERE tenant_id=%s AND object_type=%s "
                "AND object_id=%s AND tag_code=%s",
                (tenant_id, otype, str(data["object_id"]), tag_code),
            )
            return cur.fetchone()

    def remove_tag(self, tenant_id: int, tag_code: str, object_type: str, object_id: str) -> bool:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM object_tags WHERE tenant_id=%s AND tag_code=%s "
                "AND object_type=%s AND object_id=%s",
                (tenant_id, tag_code, object_type, str(object_id)),
            )
            return cur.rowcount > 0

    def object_tags(self, tenant_id: int, object_type: str, object_id: str) -> list[dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT tag_code, source, assigned_by, assigned_at FROM object_tags "
                "WHERE tenant_id=%s AND object_type=%s AND object_id=%s ORDER BY assigned_at DESC",
                (tenant_id, object_type, str(object_id)),
            )
            return list(cur.fetchall())

    # ── 泛对象群组 ───────────────────────────────────────────────────────
    def list_groups(self, tenant_id: int, filter_type: str | None = None) -> list[dict]:
        sql = "SELECT * FROM user_groups WHERE tenant_id=%s"
        params: list[Any] = [tenant_id]
        if filter_type in ("static", "dynamic"):
            sql += " AND group_type=%s"
            params.append(filter_type)
        sql += " ORDER BY group_id"
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return [self._loads(r, ("filter_rule",)) for r in cur.fetchall()]

    def refresh_group(self, tenant_id: int, group_id: int) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM user_groups WHERE tenant_id=%s AND group_id=%s",
                (tenant_id, group_id),
            )
            group = self._loads(cur.fetchone(), ("filter_rule",))
        if not group:
            raise ObjectError("群组不存在")
        rule = group.get("filter_rule") or {}
        if not isinstance(rule, dict) or not (rule.get("conditions") or rule.get("relations")):
            raise ObjectError("该群组无动态 filter_rule，无法刷新")

        object_type = rule.get("object") or group.get("member_object_type") or "user"
        if object_type not in OBJECT_REGISTRY:
            raise ObjectError(f"未知成员对象类型: {object_type}")
        id_field = OBJECT_REGISTRY[object_type]["id"]

        # 复用 ObjectService（validate→compile）做圈人，不手拼业务 SQL
        result = self.objects.search(
            tenant_id, object_type,
            rule.get("conditions") or [], rule.get("relations") or [],
            limit=100000, count_only=False, logic=rule.get("logic", "AND"),
        )
        ids = [str(r[id_field]) for r in result.get("data", []) if r.get(id_field) is not None]

        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "DELETE FROM object_group_members WHERE tenant_id=%s AND group_id=%s AND source='dynamic'",
                (tenant_id, group_id),
            )
            if ids:
                cur.executemany(
                    "INSERT INTO object_group_members "
                    "(tenant_id, group_id, object_type, object_id, source) "
                    "VALUES (%s, %s, %s, %s, 'dynamic') "
                    "ON DUPLICATE KEY UPDATE source=VALUES(source)",
                    [(tenant_id, group_id, object_type, oid) for oid in ids],
                )
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM object_group_members WHERE tenant_id=%s AND group_id=%s",
                (tenant_id, group_id),
            )
            member_count = int(cur.fetchone()["cnt"])
            cur.execute(
                "UPDATE user_groups SET member_count=%s, updated_at=NOW() "
                "WHERE tenant_id=%s AND group_id=%s",
                (member_count, tenant_id, group_id),
            )
        return {
            "group_id": group_id, "object_type": object_type,
            "matched": len(ids), "member_count": member_count, "source": "dynamic",
        }

    # ── SQL 特征 ─────────────────────────────────────────────────────────
    def create_sql_trait(self, tenant_id: int, data: dict) -> dict:
        trait_id = data.get("trait_id") or _gen_id("trait")
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sql_trait_definitions
                    (tenant_id, trait_id, trait_code, trait_name, sql_query,
                     warehouse_type, warehouse_id, schedule_type, schedule_cron,
                     result_table, enabled)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    trait_code=VALUES(trait_code), trait_name=VALUES(trait_name),
                    sql_query=VALUES(sql_query), warehouse_type=VALUES(warehouse_type),
                    warehouse_id=VALUES(warehouse_id), schedule_type=VALUES(schedule_type),
                    schedule_cron=VALUES(schedule_cron), result_table=VALUES(result_table),
                    enabled=VALUES(enabled)
                """,
                (
                    tenant_id, trait_id, data["trait_code"], data.get("trait_name"),
                    data["sql_query"], data.get("warehouse_type", "mysql"),
                    data.get("warehouse_id"), data.get("schedule_type", "manual"),
                    data.get("schedule_cron"), data.get("result_table"),
                    int(bool(data.get("enabled", True))),
                ),
            )
            cur.execute(
                "SELECT * FROM sql_trait_definitions WHERE tenant_id=%s AND trait_id=%s",
                (tenant_id, trait_id),
            )
            return cur.fetchone()

    def list_sql_traits(self, tenant_id: int) -> list[dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT d.*, (
                    SELECT COUNT(*) FROM sql_trait_results r
                    WHERE r.tenant_id=d.tenant_id AND r.trait_id=d.trait_id
                ) AS result_count
                FROM sql_trait_definitions d
                WHERE d.tenant_id=%s ORDER BY d.created_at DESC, d.trait_id
                """,
                (tenant_id,),
            )
            return list(cur.fetchall())

    @staticmethod
    def _assert_readonly(sql: str) -> str:
        """SQL 特征是显式管理员定义（对标 Segment SQL Traits），但仍做安全闸：
        仅允许单条 SELECT，且必须含 tenant_id（强制租户隔离）。"""
        stripped = sql.strip().rstrip(";").strip()
        if ";" in stripped:
            raise ObjectError("SQL 特征仅允许单条语句")
        if not re.match(r"(?is)^(select|with)\b", stripped):
            raise ObjectError("SQL 特征仅允许 SELECT/WITH 只读查询")
        if "tenant_id" not in stripped.lower():
            raise ObjectError("SQL 特征必须包含 tenant_id 过滤")
        return stripped

    def execute_sql_traits(self, tenant_id: int, trait_id: str | None) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            if trait_id:
                cur.execute(
                    "SELECT * FROM sql_trait_definitions WHERE tenant_id=%s AND trait_id=%s",
                    (tenant_id, trait_id),
                )
            else:
                cur.execute(
                    "SELECT * FROM sql_trait_definitions WHERE tenant_id=%s AND enabled=1",
                    (tenant_id,),
                )
            traits = list(cur.fetchall())
        if trait_id and not traits:
            raise ObjectError("SQL 特征不存在")

        start = time.perf_counter()
        executed, total_rows, per_trait = 0, 0, []
        for t in traits:
            safe_sql = self._assert_readonly(t["sql_query"])
            with self._conn() as conn, conn.cursor() as cur:
                # tenant_id 作为命名参数注入（查询需自行 WHERE tenant_id=%(tenant_id)s）
                try:
                    cur.execute(safe_sql, {"tenant_id": tenant_id})
                except Exception:
                    cur.execute(safe_sql)
                rows = list(cur.fetchall())
                written = 0
                for r in rows:
                    if "object_id" not in r or "trait_value" not in r:
                        raise ObjectError("SQL 特征结果需包含 object_id 与 trait_value 列")
                    cur.execute(
                        """
                        INSERT INTO sql_trait_results
                            (tenant_id, trait_id, object_type, object_id, trait_value)
                        VALUES (%s, %s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE
                            trait_value=VALUES(trait_value), computed_at=CURRENT_TIMESTAMP,
                            version=version+1
                        """,
                        (
                            tenant_id, t["trait_id"],
                            str(r.get("object_type") or "user"),
                            str(r["object_id"]),
                            None if r["trait_value"] is None else str(r["trait_value"]),
                        ),
                    )
                    written += 1
                cur.execute(
                    "UPDATE sql_trait_definitions SET last_run_time=NOW(), last_row_count=%s "
                    "WHERE tenant_id=%s AND trait_id=%s",
                    (written, tenant_id, t["trait_id"]),
                )
            executed += 1
            total_rows += written
            per_trait.append({"trait_id": t["trait_id"], "trait_code": t["trait_code"], "rows": written})
        return {
            "executed": executed, "row_count": total_rows,
            "elapsed_ms": round((time.perf_counter() - start) * 1000, 2),
            "traits": per_trait,
        }

    # ── 预测模型 ─────────────────────────────────────────────────────────
    def create_prediction(self, tenant_id: int, data: dict) -> dict:
        model_id = data.get("model_id") or _gen_id("model")
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO prediction_models
                    (tenant_id, model_id, model_name, model_type, target_event,
                     features, training_data_days, inference_horizon, enabled)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    model_type=VALUES(model_type), target_event=VALUES(target_event),
                    features=VALUES(features), training_data_days=VALUES(training_data_days),
                    inference_horizon=VALUES(inference_horizon), enabled=VALUES(enabled)
                """,
                (
                    tenant_id, model_id, data["model_name"], data["model_type"],
                    data.get("target_event"),
                    json.dumps(data.get("features") or [], ensure_ascii=False),
                    data.get("training_data_days"), data.get("inference_horizon"),
                    int(bool(data.get("enabled", True))),
                ),
            )
            cur.execute(
                "SELECT * FROM prediction_models WHERE tenant_id=%s AND model_id=%s",
                (tenant_id, model_id),
            )
            return self._loads(cur.fetchone(), ("features",))

    def list_predictions(self, tenant_id: int) -> list[dict]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM prediction_models WHERE tenant_id=%s ORDER BY created_at DESC, model_id",
                (tenant_id,),
            )
            return [self._loads(r, ("features",)) for r in cur.fetchall()]

    def infer_prediction(self, tenant_id: int, model_id: str, limit: int = 1000) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM prediction_models WHERE tenant_id=%s AND model_id=%s",
                (tenant_id, model_id),
            )
            model = cur.fetchone()
        if not model:
            raise ObjectError("预测模型不存在")

        # 推理结果写入用户宽表 properties.pred_<model>（JSON_SET 路径作为绑定参数，防注入）
        path = f"$.pred_{_safe_key(model.get('model_name') or model_id)}"
        start = time.perf_counter()
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT one_id FROM doris_user_wide WHERE tenant_id=%s LIMIT %s",
                (tenant_id, int(min(max(limit, 1), 100000))),
            )
            one_ids = [r["one_id"] for r in cur.fetchall()]
            rows = 0
            for oid in one_ids:
                # 模拟评分：基于 one_id 的确定性伪分值（dev 模拟，非真实模型）
                score = round((hash((model_id, oid)) % 1000) / 1000.0, 3)
                cur.execute(
                    "UPDATE doris_user_wide "
                    "SET properties = JSON_SET(COALESCE(properties, JSON_OBJECT()), %s, %s) "
                    "WHERE tenant_id=%s AND one_id=%s",
                    (path, score, tenant_id, oid),
                )
                rows += 1
            quality = round(60 + (hash(model_id) % 4000) / 100.0, 2)
            cur.execute(
                "UPDATE prediction_models SET last_inference_at=NOW(), quality_score=%s "
                "WHERE tenant_id=%s AND model_id=%s",
                (quality, tenant_id, model_id),
            )
        return {
            "model_id": model_id, "property_key": path, "row_count": rows,
            "quality_score": quality,
            "elapsed_ms": round((time.perf_counter() - start) * 1000, 2),
        }

    # ── 档案回流（Reverse-ETL）──────────────────────────────────────────
    def sync_profiles(self, tenant_id: int, data: dict) -> dict:
        job_id = data.get("job_id") or _gen_id("retl")
        tables = data.get("tables") or []
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO connections_reverse_etl_jobs
                    (tenant_id, job_id, job_name, source_object, destination_id,
                     schedule_cron, enabled, last_run_time, last_status)
                VALUES (%s, %s, %s, %s, %s, %s, 1, NOW(), 'success')
                ON DUPLICATE KEY UPDATE
                    job_name=VALUES(job_name), source_object=VALUES(source_object),
                    destination_id=VALUES(destination_id), schedule_cron=VALUES(schedule_cron),
                    last_run_time=NOW(), last_status='success'
                """,
                (
                    tenant_id, job_id, data.get("job_name") or "profile-sync",
                    data.get("source_object", "doris_user_wide"),
                    data.get("target_warehouse"), data.get("schedule"),
                ),
            )
            # 统计本次同步行数（源对象当前租户行数）
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM doris_user_wide WHERE tenant_id=%s",
                (tenant_id,),
            )
            row_count = int(cur.fetchone()["cnt"])
            run_id = _gen_id("run")
            cur.execute(
                """
                INSERT INTO connections_reverse_etl_runs
                    (tenant_id, run_id, job_id, start_time, end_time, duration_ms,
                     row_count, status)
                VALUES (%s, %s, %s, NOW(), NOW(), 0, %s, 'success')
                """,
                (tenant_id, run_id, job_id, row_count),
            )
            cur.execute(
                "UPDATE connections_reverse_etl_jobs "
                "SET total_synced_rows = total_synced_rows + %s WHERE tenant_id=%s AND job_id=%s",
                (row_count, tenant_id, job_id),
            )
        return {
            "job_id": job_id, "run_id": run_id, "status": "success",
            "target_warehouse": data.get("target_warehouse"),
            "tables": tables, "row_count": row_count,
        }

    # ── 泛对象搜索（叠加 object_tags 过滤）──────────────────────────────
    def search_with_tags(self, body: UnifyObjectSearchIn) -> dict:
        otype = body.object
        if otype not in OBJECT_REGISTRY:
            raise ObjectError(f"未知对象类型: {otype}")
        id_field = OBJECT_REGISTRY[otype]["id"]
        tag_codes = body.tag_codes or []

        # 无标签条件 → 直接走 ObjectService（含 count_only 路径）
        if not tag_codes:
            return self.objects.search(
                body.tenant_id, otype, body.conditions, body.relations,
                body.limit, body.count_only, body.logic,
            )

        # 有标签条件：先用 ObjectService 取候选（不手拼业务 SQL），再用 object_tags 过滤
        base = self.objects.search(
            body.tenant_id, otype, body.conditions, body.relations,
            limit=5000, count_only=False, logic=body.logic,
        )
        rows = base.get("data", [])
        allowed = self._tag_matched_ids(body.tenant_id, otype, tag_codes, body.tag_logic)
        filtered = [r for r in rows if str(r.get(id_field)) in allowed]

        if body.count_only:
            return {"object": otype, "estimate": len(filtered), "tag_codes": tag_codes}

        trimmed = filtered[: min(max(body.limit, 1), 1000)]
        # 回填每个对象的全部标签
        for r in trimmed:
            r["object_tags"] = self.object_tags(body.tenant_id, otype, str(r.get(id_field)))
        return {
            "object": otype, "row_count": len(trimmed), "matched": len(filtered),
            "tag_codes": tag_codes, "data": trimmed,
        }

    def _tag_matched_ids(self, tenant_id: int, object_type: str,
                         tag_codes: list[str], tag_logic: str) -> set[str]:
        placeholders = ",".join(["%s"] * len(tag_codes))
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT object_id, COUNT(DISTINCT tag_code) AS hit FROM object_tags "
                f"WHERE tenant_id=%s AND object_type=%s AND tag_code IN ({placeholders}) "
                f"GROUP BY object_id",
                [tenant_id, object_type, *tag_codes],
            )
            need = len(tag_codes) if str(tag_logic).lower() == "and" else 1
            return {str(r["object_id"]) for r in cur.fetchall() if int(r["hit"]) >= need}


unify_service = UnifyService()


# ── 路由 ─────────────────────────────────────────────────────────────────

def _wrap(fn, *args):
    try:
        return fn(*args)
    except ObjectError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        if "Duplicate" in str(e):
            raise HTTPException(status_code=409, detail="记录已存在")
        raise HTTPException(status_code=500, detail=str(e))


# 身份解析规则
@router.get("/identity-rules/{tenant_id}")
def list_identity_rules(tenant_id: int):
    return _wrap(unify_service.list_identity_rules, tenant_id)


@router.post("/identity-rules/{tenant_id}", status_code=201)
def upsert_identity_rule(tenant_id: int, body: IdentityRuleIn):
    return _wrap(unify_service.upsert_identity_rule, tenant_id, body.model_dump())


@router.delete("/identity-rules/{tenant_id}/{rule_id}")
def delete_identity_rule(tenant_id: int, rule_id: str):
    if not unify_service.delete_identity_rule(tenant_id, rule_id):
        raise HTTPException(status_code=404, detail="规则不存在")
    return {"ok": True}


# 任意对象打标
@router.post("/tags/{tenant_id}/{code}/assign", status_code=201)
def assign_tag(tenant_id: int, code: str, body: TagAssignIn):
    return _wrap(unify_service.assign_tag, tenant_id, code, body.model_dump())


@router.delete("/tags/{tenant_id}/{code}/object/{object_type}/{object_id}")
def remove_tag(tenant_id: int, code: str, object_type: str, object_id: str):
    if not unify_service.remove_tag(tenant_id, code, object_type, object_id):
        raise HTTPException(status_code=404, detail="标签关联不存在")
    return {"ok": True}


@router.get("/object-tags/{tenant_id}/{object_type}/{object_id}")
def get_object_tags(tenant_id: int, object_type: str, object_id: str):
    return {
        "tenant_id": tenant_id, "object_type": object_type, "object_id": object_id,
        "tags": unify_service.object_tags(tenant_id, object_type, object_id),
    }


# 泛对象群组
@router.get("/groups/{tenant_id}")
def list_groups(tenant_id: int, filter_type: str | None = None):
    return _wrap(unify_service.list_groups, tenant_id, filter_type)


@router.post("/groups/{tenant_id}/{group_id}/refresh")
def refresh_group(tenant_id: int, group_id: int):
    return _wrap(unify_service.refresh_group, tenant_id, group_id)


# SQL 特征
@router.post("/sql-traits/{tenant_id}", status_code=201)
def create_sql_trait(tenant_id: int, body: SqlTraitIn):
    return _wrap(unify_service.create_sql_trait, tenant_id, body.model_dump())


@router.get("/sql-traits/{tenant_id}")
def list_sql_traits(tenant_id: int):
    return _wrap(unify_service.list_sql_traits, tenant_id)


@router.post("/sql-traits/{tenant_id}/{trait_id}/execute")
def execute_sql_trait(tenant_id: int, trait_id: str):
    return _wrap(unify_service.execute_sql_traits, tenant_id, trait_id)


@router.post("/sql-traits/{tenant_id}/execute")
def execute_all_sql_traits(tenant_id: int, body: SqlTraitExecuteIn | None = None):
    trait_id = body.trait_id if body else None
    return _wrap(unify_service.execute_sql_traits, tenant_id, trait_id)


# 预测模型
@router.post("/predictions/{tenant_id}", status_code=201)
def create_prediction(tenant_id: int, body: PredictionModelIn):
    return _wrap(unify_service.create_prediction, tenant_id, body.model_dump())


@router.get("/predictions/{tenant_id}")
def list_predictions(tenant_id: int):
    return _wrap(unify_service.list_predictions, tenant_id)


@router.post("/predictions/{tenant_id}/{model_id}/infer")
def infer_prediction(tenant_id: int, model_id: str):
    return _wrap(unify_service.infer_prediction, tenant_id, model_id)


# 档案回流
@router.post("/profiles/sync/{tenant_id}", status_code=201)
def sync_profiles(tenant_id: int, body: ProfileSyncIn):
    return _wrap(unify_service.sync_profiles, tenant_id, body.model_dump())


# 泛对象搜索（叠加标签过滤）
@router.post("/objects/search")
def search_objects_with_tags(body: UnifyObjectSearchIn):
    return _wrap(unify_service.search_with_tags, body)
