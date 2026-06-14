"""全模块 MCP 只读工具测试（stdio）。

通过真实 MCP 协议拉起 services/mcp/server.py，校验 00~09 各模块的只读工具
都已注册、且调用 sql-engine 不报错。服务未就绪则整体 skip。
"""

import asyncio
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

# (工具名, 调用参数) —— 覆盖 00~09 各模块核心只读能力
CALLS = [
    ("cdp_tenants", {}), ("cdp_tenant_config", {}),
    ("cdp_sources", {}), ("cdp_destinations", {}), ("cdp_pipelines", {}),
    ("cdp_reverse_etl_jobs", {}), ("cdp_warehouses", {}), ("cdp_functions", {}),
    ("cdp_groups", {}), ("cdp_identity_rules", {}), ("cdp_sql_traits", {}),
    ("cdp_predictions", {}), ("cdp_object_tags", {"object_type": "user", "object_id": "100001"}),
    ("cdp_object_model", {}),
    ("cdp_accounts", {}),
    ("cdp_journeys", {}), ("cdp_broadcasts", {}),
    ("cdp_tracking_plans", {}), ("cdp_violations", {}), ("cdp_transformations", {}),
    ("cdp_pii_rules", {}), ("cdp_consent_categories", {}), ("cdp_deletion_requests", {}),
    ("cdp_monitor_overview", {}), ("cdp_monitor_metrics", {}), ("cdp_delivery_logs", {}),
    ("cdp_alerts", {}),
    ("cdp_iam_users", {}), ("cdp_iam_roles", {}), ("cdp_audit_logs", {}),
]


async def _probe():
    params = StdioServerParameters(
        command=sys.executable,
        args=[os.path.join(REPO, "services", "mcp", "server.py")],
        env={**os.environ, "SQL_ENGINE_URL": SQL_ENGINE, "no_proxy": "*", "NO_PROXY": "*"},
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as s:
            await s.initialize()
            names = {t.name for t in (await s.list_tools()).tools}
            failures = []
            for tool, args in CALLS:
                if tool not in names:
                    failures.append(f"{tool}: 未注册")
                    continue
                res = await s.call_tool(tool, args)
                if res.isError:
                    txt = res.content[0].text if res.content else ""
                    failures.append(f"{tool}: {txt[:120]}")
            return names, failures


def test_all_module_tools_registered_and_callable():
    names, failures = asyncio.run(_probe())
    # 各模块代表性工具均已注册
    assert {"cdp_tenants", "cdp_object_model", "cdp_groups", "cdp_monitor_overview",
            "cdp_pii_rules", "cdp_journeys", "cdp_tracking_plans", "cdp_iam_users"}.issubset(names)
    assert not failures, "MCP 工具调用失败:\n" + "\n".join(failures)
