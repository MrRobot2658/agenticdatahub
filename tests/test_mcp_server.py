"""CDP MCP Server 测试（stdio）。

前置：docker compose up -d mysql redis sql-engine && bash scripts/apply_migrations.sh
通过 stdio 拉起 services/mcp/server.py，校验工具清单与关键调用。
"""

import asyncio
import json
import os
import sys

import pytest
import requests

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SQL_ENGINE = os.getenv("SQL_ENGINE_URL", "http://localhost:8002")

mcp = pytest.importorskip("mcp")
from mcp import ClientSession, StdioServerParameters  # noqa: E402
from mcp.client.stdio import stdio_client  # noqa: E402


def _sql_engine_up() -> bool:
    s = requests.Session()
    s.trust_env = False
    try:
        return s.get(f"{SQL_ENGINE}/health", timeout=3).status_code == 200
    except requests.RequestException:
        return False


pytestmark = pytest.mark.skipif(not _sql_engine_up(), reason="sql-engine 未就绪")


async def _run(tool: str, args: dict):
    params = StdioServerParameters(
        command=sys.executable,
        args=[os.path.join(REPO, "services", "mcp", "server.py")],
        env={**os.environ, "SQL_ENGINE_URL": SQL_ENGINE, "no_proxy": "*"},
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as s:
            await s.initialize()
            if tool == "__list__":
                return [t.name for t in (await s.list_tools()).tools]
            res = await s.call_tool(tool, args)
            return json.loads(res.content[0].text)


def call(tool: str, args: dict | None = None):
    return asyncio.run(_run(tool, args or {}))


def test_tools_registered():
    names = set(call("__list__"))
    assert {"cdp_schema", "cdp_search", "cdp_estimate", "cdp_nl_segment"}.issubset(names)


def test_schema_lists_objects():
    data = call("cdp_schema", {})
    assert {o["object"] for o in data["objects"]} == {"user", "lead", "account", "product", "store"}


def test_nl_segment_documented_example():
    d = call("cdp_nl_segment", {"question": "地址在上海、公司规模大于500的线索，且关联用户带VIP标签"})
    assert d["needs_clarification"] is False
    assert d["estimate"] >= 2
    assert "线索" in d["summary"]


def test_search_cross_object():
    d = call("cdp_search", {
        "object": "lead",
        "conditions": [{"field": "city", "op": "eq", "value": "上海"},
                       {"field": "company_size", "op": "gt", "value": 500}],
        "relations": [{"rel_type": "belongs_to", "object": "user",
                       "conditions": [{"field": "tags", "op": "contains", "value": "vip"}]}],
    })
    ids = {r["lead_id"] for r in d["data"]}
    assert {"L2001", "L2005"}.issubset(ids)


def test_nl_vague_clarification():
    d = call("cdp_nl_segment", {"question": "帮我找近期活跃的用户"})
    assert d["needs_clarification"] is True
