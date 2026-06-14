"""CDP 只读 MCP Server（stdio）— 文档 Ch4.4 / CDP Agent Phase 1「基础只读 MCP」

把 sql-engine 的多对象筛选 / DSL 校验 / 人数预估 / NL 圈人能力，封装为 Claude 可调用的工具。
只读：查 schema、跨对象筛选、人数预估、校验/翻译、NL→候选规则、列 Segment。
不写规则、不绕权限（保存仍走人工确认链路）。

运行：python services/mcp/server.py   （由 Claude 以 stdio 方式拉起）
依赖 sql-engine：默认 http://localhost:8002，可用 SQL_ENGINE_URL 覆盖。
"""

import json
import logging
import os
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

BASE = os.getenv("SQL_ENGINE_URL", "http://localhost:8002").rstrip("/")
DEFAULT_TENANT = int(os.getenv("CDP_TENANT_ID", "1001"))

# trust_env=False：绕过本机 http_proxy，避免 localhost 被代理（502）
_client = httpx.Client(timeout=45.0, trust_env=False)

mcp = FastMCP("cdp")

# ── 查询日志 ────────────────────────────────────────────────────────────────
# 每次查询记录：SQL（若响应携带）+ MCP 调用→返回的 round-trip 耗时。
# 注意：MCP 走 stdio，stdout 被 JSON-RPC 占用，日志只能落文件 / stderr，绝不能 print 到 stdout。
_LOG_DIR = Path(os.getenv("MCP_LOG_DIR", Path(__file__).parent / "logs"))
_LOG_DIR.mkdir(parents=True, exist_ok=True)
_logger = logging.getLogger("cdp.mcp.query")
_logger.setLevel(logging.INFO)
_logger.propagate = False
if not _logger.handlers:
    _h = RotatingFileHandler(
        _LOG_DIR / "mcp_queries.log", maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    _h.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    _logger.addHandler(_h)


def _log_query(path: str, request: dict | None, result: Any, elapsed_ms: float) -> None:
    """记录一次查询：endpoint、请求体、SQL（若有）、MCP round-trip 耗时。"""
    sql = result.get("sql") if isinstance(result, dict) else None
    db_ms = result.get("elapsed_ms") if isinstance(result, dict) else None
    record = {
        "endpoint": path,
        "request": request,
        "sql": sql,                 # 数据库实际执行的 SQL（estimate/search 等携带）
        "db_elapsed_ms": db_ms,     # ⑥ Doris/MySQL 执行耗时
        "mcp_roundtrip_ms": elapsed_ms,  # MCP 调用→返回总耗时（含 HTTP + 编译 + 序列化）
    }
    _logger.info(json.dumps(record, ensure_ascii=False, default=str))


def _get(path: str, params: dict | None = None) -> Any:
    start = time.perf_counter()
    r = _client.get(BASE + path, params=params)
    r.raise_for_status()
    result = r.json()
    _log_query(path, params, result, round((time.perf_counter() - start) * 1000, 2))
    return result


def _post(path: str, body: dict, params: dict | None = None) -> Any:
    start = time.perf_counter()
    r = _client.post(BASE + path, json=body, params=params)
    if r.status_code >= 400:
        result: Any = {"error": r.status_code, "detail": _safe_json(r)}
    else:
        result = r.json()
    _log_query(path, body, result, round((time.perf_counter() - start) * 1000, 2))
    return result


def _safe_json(r: httpx.Response) -> Any:
    try:
        return r.json()
    except Exception:  # noqa: BLE001
        return r.text


@mcp.tool()
def cdp_schema(tenant_id: int = DEFAULT_TENANT) -> dict:
    """返回可用对象类型(User/Lead/Account/Product/Store)、字段定义与关联矩阵。
    在构造筛选条件前先调用，确保只用真实存在的字段与已定义的关联。"""
    return _get(f"/metadata/{tenant_id}/fields")


@mcp.tool()
def cdp_search(
    object: str,
    conditions: list[dict] | None = None,
    relations: list[dict] | None = None,
    tenant_id: int = DEFAULT_TENANT,
    limit: int = 50,
) -> dict:
    """跨对象筛选并返回命中明细。
    object: base 对象(lead/user/account/product/store)。
    conditions: [{"field","op","value"}]，op ∈ eq/ne/gt/ge/lt/le/in/not_in/contains/between/like。
    relations: [{"rel_type","object","direction"?,"conditions"?,"edge_conditions"?,"relations"?}]，
        经 object_relations JOIN，整棵树≤3 跳。可嵌套 relations 实现链式多跳(每跳 target 为下一跳锚点)。
        edge_conditions 作用在关系行上，字段限 create_time / properties.<key>(如购买时间过滤)。
    例1：上海且规模>500 的线索且关联用户带 vip → object=lead,
        conditions=[{city eq 上海},{company_size gt 500}],
        relations=[{belongs_to user, conditions=[{tags contains vip}]}]。
    例2：过去30天有过购买的用户 → object=user,
        relations=[{owns account, relations=[{purchased product,
            edge_conditions=[{create_time between [2026-05-14, 2026-06-14]}]}]}]。"""
    return _post("/objects/search", {
        "tenant_id": tenant_id, "object": object,
        "conditions": conditions or [], "relations": relations or [], "limit": limit,
    })


@mcp.tool()
def cdp_estimate(
    object: str,
    conditions: list[dict] | None = None,
    relations: list[dict] | None = None,
    tenant_id: int = DEFAULT_TENANT,
) -> dict:
    """人数预估（dry-run COUNT，不返回明细）。保存 Segment 前先看规模。"""
    return _post("/dsl/estimate", {
        "tenant_id": tenant_id, "object": object,
        "conditions": conditions or [], "relations": relations or [],
    })


@mcp.tool()
def cdp_validate(
    object: str,
    conditions: list[dict] | None = None,
    relations: list[dict] | None = None,
    logic: str = "AND",
    tenant_id: int = DEFAULT_TENANT,
) -> dict:
    """校验候选 DSL：字段是否存在、操作符是否合法、关联是否定义、跳数是否≤3。返回 {ok, errors}。"""
    return _post("/dsl/validate", {
        "tenant_id": tenant_id, "object": object, "logic": logic,
        "conditions": conditions or [], "relations": relations or [],
    })


@mcp.tool()
def cdp_translate(
    object: str,
    conditions: list[dict] | None = None,
    relations: list[dict] | None = None,
    logic: str = "AND",
    tenant_id: int = DEFAULT_TENANT,
) -> dict:
    """把 DSL 规则翻译成业务可读中文摘要 + 每条件解释（字段/操作符/取值）。"""
    return _post("/dsl/echo", {
        "tenant_id": tenant_id, "object": object, "logic": logic,
        "conditions": conditions or [], "relations": relations or [],
    })


@mcp.tool()
def cdp_nl_segment(question: str, tenant_id: int = DEFAULT_TENANT) -> dict:
    """自然语言圈人：输入中文人群描述，返回候选 DSL + 解释 + 人数预估；
    表达模糊时返回澄清问题（needs_clarification=true）。仅生成候选，不直接保存。"""
    return _post("/agent/segment/draft", {"tenant_id": tenant_id, "question": question})


@mcp.tool()
def cdp_list_segments(tenant_id: int = DEFAULT_TENANT) -> list:
    """列出已保存的人群 Segment 规则。"""
    return _get(f"/segments/{tenant_id}")


# ══════════════════════════════════════════════════════════════════════════
# 全模块只读能力（00~09）—— 均为读，不写不改；写操作仍走各自人工确认链路。
# ══════════════════════════════════════════════════════════════════════════

# ── 00 平台 Platform ──────────────────────────────────────────────────────
@mcp.tool()
def cdp_tenants(search: str | None = None, tier: str | None = None,
                status: str | None = None, limit: int = 50) -> dict:
    """列出租户（名称/tier/状态/scale 档位/近 24h 事件量），支持 search/tier/status 过滤。"""
    return _get("/platform/tenants",
                {"search": search, "tier": tier, "status": status, "limit": limit})


@mcp.tool()
def cdp_tenant_config(tenant_id: int = DEFAULT_TENANT, domain: str | None = None) -> dict:
    """查某租户的每域有效配置（基础/数据通道/容量/ID-Mapping/存储/隐私/集成/配额）。"""
    return _get(f"/platform/tenants/{tenant_id}/config", {"domain": domain})


# ── 01 连接 Connections ───────────────────────────────────────────────────
@mcp.tool()
def cdp_sources(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出数据源 Sources（含 write_key / 类型 / 状态）。"""
    return _get("/connections/sources", {"tenant_id": tenant_id})


@mcp.tool()
def cdp_destinations(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出目的地 Destinations（投递目标 + 映射 + 状态）。"""
    return _get("/connections/destinations", {"tenant_id": tenant_id})


@mcp.tool()
def cdp_pipelines(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出可视化编排管道 Pipelines（source→transform→destination 拓扑）。"""
    return _get("/connections/pipelines", {"tenant_id": tenant_id})


@mcp.tool()
def cdp_reverse_etl_jobs(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出反向 ETL 任务（数仓宽表→目的地，含调度）。"""
    return _get("/connections/reverse-etl/jobs", {"tenant_id": tenant_id})


@mcp.tool()
def cdp_warehouses(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出数据仓库连接 Warehouses。"""
    return _get("/connections/warehouses", {"tenant_id": tenant_id})


@mcp.tool()
def cdp_functions(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出自定义函数 Functions。"""
    return _get("/connections/functions", {"tenant_id": tenant_id})


# ── 02 统一 Unify ─────────────────────────────────────────────────────────
@mcp.tool()
def cdp_groups(tenant_id: int = DEFAULT_TENANT, filter_type: str | None = None) -> Any:
    """列出群组/人群包（filter_type=static|dynamic 过滤；动态群组带 filter_rule）。"""
    return _get(f"/unify/groups/{tenant_id}", {"filter_type": filter_type})


@mcp.tool()
def cdp_identity_rules(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出身份解析规则（merge 策略/标识符优先级/上限）。"""
    return _get(f"/unify/identity-rules/{tenant_id}")


@mcp.tool()
def cdp_sql_traits(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出 SQL 计算特征定义。"""
    return _get(f"/unify/sql-traits/{tenant_id}")


@mcp.tool()
def cdp_predictions(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出预测模型定义。"""
    return _get(f"/unify/predictions/{tenant_id}")


@mcp.tool()
def cdp_object_tags(object_type: str, object_id: str, tenant_id: int = DEFAULT_TENANT) -> Any:
    """查某对象实例（任意对象）上挂的标签。"""
    return _get(f"/unify/object-tags/{tenant_id}/{object_type}/{object_id}")


# ── 03 对象 Objects ───────────────────────────────────────────────────────
@mcp.tool()
def cdp_object_model(tenant_id: int = DEFAULT_TENANT) -> dict:
    """对象模型全景：内置+自建对象定义（字段/主键/表）与关系矩阵（含边属性）。"""
    return _get(f"/objects/{tenant_id}/definitions")


@mcp.tool()
def cdp_object_record(object_key: str, pk_value: str, tenant_id: int = DEFAULT_TENANT) -> Any:
    """查单条对象记录的字段明细。"""
    return _get(f"/objects/{tenant_id}/{object_key}/{pk_value}")


@mcp.tool()
def cdp_object_record_relations(object_key: str, pk_value: str,
                                tenant_id: int = DEFAULT_TENANT) -> Any:
    """查单条对象记录的一跳关联对象（正向/反向，按 rel_type 分组）。"""
    return _get(f"/objects/{tenant_id}/{object_key}/{pk_value}/relations")


# ── 04 客户 Accounts ──────────────────────────────────────────────────────
@mcp.tool()
def cdp_accounts(tenant_id: int = DEFAULT_TENANT, limit: int = 50) -> Any:
    """列出客户（account）主数据。"""
    return _get("/accounts", {"tenant_id": tenant_id, "limit": limit})


@mcp.tool()
def cdp_account_detail(account_id: str, tenant_id: int = DEFAULT_TENANT) -> Any:
    """查客户详情 + 关联用户 + 聚合指标。"""
    return {
        "detail": _get(f"/accounts/{account_id}", {"tenant_id": tenant_id}),
        "users": _get(f"/accounts/{account_id}/users", {"tenant_id": tenant_id}),
        "aggregates": _get(f"/accounts/{account_id}/aggregates", {"tenant_id": tenant_id}),
    }


# ── 05 触达 Engage ────────────────────────────────────────────────────────
@mcp.tool()
def cdp_journeys(tenant_id: int = DEFAULT_TENANT, status: str | None = None) -> Any:
    """列出旅程 Journeys（多步自动化）。"""
    return _get("/engage/journeys", {"tenant_id": tenant_id, "status": status})


@mcp.tool()
def cdp_broadcasts(tenant_id: int = DEFAULT_TENANT, status: str | None = None) -> Any:
    """列出群发 Broadcasts（一次性触达）。"""
    return _get("/engage/broadcasts", {"tenant_id": tenant_id, "status": status})


# ── 06 协议 Protocols ─────────────────────────────────────────────────────
@mcp.tool()
def cdp_tracking_plans(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出埋点计划 Tracking Plans。"""
    return _get("/protocols/tracking-plans", {"tenant_id": tenant_id})


@mcp.tool()
def cdp_violations(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出埋点违规 Violations。"""
    return _get("/protocols/violations", {"tenant_id": tenant_id})


@mcp.tool()
def cdp_transformations(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出数据转换 Transformations。"""
    return _get("/protocols/transformations", {"tenant_id": tenant_id})


# ── 07 隐私 Privacy ───────────────────────────────────────────────────────
@mcp.tool()
def cdp_pii_rules(tenant_id: int = DEFAULT_TENANT, object_type: str | None = None) -> Any:
    """列出 PII 管控规则（字段→脱敏/哈希/加密/拦截）。"""
    return _get("/privacy/pii/rules", {"tenant_id": tenant_id, "object_type": object_type})


@mcp.tool()
def cdp_consent_categories(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出同意分类 Consent Categories。"""
    return _get("/privacy/consent/categories", {"tenant_id": tenant_id})


@mcp.tool()
def cdp_deletion_requests(tenant_id: int = DEFAULT_TENANT, status: str | None = None) -> Any:
    """列出删除/抑制工单 Deletion / Suppression。"""
    return _get("/privacy/deletion", {"tenant_id": tenant_id, "status": status})


@mcp.tool()
def cdp_suppression_check(identifier: str, tenant_id: int = DEFAULT_TENANT) -> Any:
    """校验某标识符是否在抑制名单中。"""
    return _get("/privacy/suppression/check", {"tenant_id": tenant_id, "identifier": identifier})


# ── 08 监控 Monitor ───────────────────────────────────────────────────────
@mcp.tool()
def cdp_monitor_overview(tenant_id: int = DEFAULT_TENANT, source: str | None = None,
                         window_minutes: int = 60) -> dict:
    """投递总览：近 window 分钟事件总数/成功率/失败数/平均延迟。"""
    return _get("/monitor/overview",
                {"tenant_id": tenant_id, "source": source, "window_minutes": window_minutes})


@mcp.tool()
def cdp_monitor_metrics(tenant_id: int = DEFAULT_TENANT, source: str | None = None) -> Any:
    """投递指标时间序列（按桶，供趋势图）。"""
    return _get("/monitor/metrics", {"tenant_id": tenant_id, "source": source})


@mcp.tool()
def cdp_delivery_logs(tenant_id: int = DEFAULT_TENANT, status: str | None = None,
                      limit: int = 50) -> Any:
    """逐事件投递日志（success/failed/retry/skipped）。"""
    return _get("/monitor/delivery-logs",
                {"tenant_id": tenant_id, "status": status, "limit": limit})


@mcp.tool()
def cdp_alerts(tenant_id: int = DEFAULT_TENANT) -> dict:
    """告警规则 + 最近告警事件。"""
    return {
        "rules": _get("/monitor/alert-rules", {"tenant_id": tenant_id}),
        "events": _get("/monitor/alert-events", {"tenant_id": tenant_id}),
    }


# ── 09 设置 Settings ──────────────────────────────────────────────────────
@mcp.tool()
def cdp_iam_users(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出 IAM 成员（用户 + 角色）。"""
    return _get("/iam/users", {"tenant_id": tenant_id})


@mcp.tool()
def cdp_iam_roles(tenant_id: int = DEFAULT_TENANT) -> Any:
    """列出 IAM 角色与权限。"""
    return _get("/iam/roles", {"tenant_id": tenant_id})


@mcp.tool()
def cdp_audit_logs(tenant_id: int = DEFAULT_TENANT, limit: int = 50) -> Any:
    """列出审计日志 Audit Trail。"""
    return _get("/iam/audit", {"tenant_id": tenant_id, "limit": limit})


if __name__ == "__main__":
    mcp.run()  # stdio
