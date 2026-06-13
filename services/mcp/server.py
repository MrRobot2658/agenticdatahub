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


if __name__ == "__main__":
    mcp.run()  # stdio
