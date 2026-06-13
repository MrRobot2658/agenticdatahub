"""NL 圈人测试（V3.0-06 Ch4 / CDP Agent Phase 1）

前置：docker compose up -d mysql redis sql-engine && bash scripts/apply_migrations.sh
规则路径为确定性，不依赖 DeepSeek；LLM 路径单独 skipif。
"""

import os

import pytest
import requests

API = "http://localhost:8002"
S = requests.Session()
S.trust_env = False
TENANT = 1001


def draft(question: str) -> dict:
    return S.post(f"{API}/agent/segment/draft",
                  json={"tenant_id": TENANT, "question": question}, timeout=45).json()


class TestDraftRuleBased:
    def test_documented_multi_object(self):
        r = draft("地址在上海、公司规模大于500的线索，且关联用户带VIP标签")
        assert r["source"] == "rule"
        assert r["needs_clarification"] is False
        rule = r["rule"]
        assert rule["object"] == "lead"
        fields = {c["field"] for c in rule["conditions"]}
        assert {"city", "company_size"} == fields
        assert rule["relations"][0]["rel_type"] == "belongs_to"
        assert rule["relations"][0]["conditions"][0]["value"] == "vip"
        assert r["estimate"] >= 2
        assert "线索" in r["summary"]

    def test_simple_city(self):
        r = draft("查上海的线索")
        assert r["rule"]["conditions"][0] == {"field": "city", "op": "eq", "value": "上海"}

    def test_vip_user_base(self):
        r = draft("VIP用户")
        assert r["rule"]["object"] == "user"
        assert r["rule"]["conditions"][0]["field"] == "tags"

    def test_account_industry(self):
        r = draft("制造业账户")
        assert r["rule"]["object"] == "account"
        assert {"field": "industry", "op": "eq", "value": "manufacturing"} in r["rule"]["conditions"]


class TestEventEdgeConditions:
    """购买/访问事件 → 链式关系 + 边条件(create_time 时间窗)，全程规则路径无需 LLM。"""

    def test_purchase_last_30_days(self):
        r = draft("过去30天有过购买的用户")
        assert r["source"] == "rule" and r["needs_clarification"] is False
        rule = r["rule"]
        assert rule["object"] == "user"
        owns = rule["relations"][0]
        assert owns["rel_type"] == "owns" and owns["object"] == "account"
        purchased = owns["relations"][0]  # 链式二跳
        assert purchased["rel_type"] == "purchased" and purchased["object"] == "product"
        edge = purchased["edge_conditions"][0]
        assert edge["field"] == "create_time" and edge["op"] == "ge"
        # 值为"今天-30天"的日期串
        from datetime import datetime, timedelta
        assert edge["value"] == (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
        assert r["estimate"] >= 0  # 能跑通 estimate（不报错即说明 DSL 合法）

    def test_purchase_without_window_no_edge(self):
        """未给时间窗 → 仍生成购买链，但不带 create_time 边条件。"""
        r = draft("买过东西的用户")
        purchased = r["rule"]["relations"][0]["relations"][0]
        assert purchased["rel_type"] == "purchased"
        assert not purchased.get("edge_conditions")

    def test_visit_last_7_days(self):
        r = draft("最近7天到店的用户")
        rel = r["rule"]["relations"][0]
        assert rel["rel_type"] == "visited" and rel["object"] == "store"
        assert rel["edge_conditions"][0]["field"] == "create_time"


class TestClarification:
    def test_vague_term_triggers_clarification(self):
        r = draft("帮我找近期活跃的用户")
        assert r["needs_clarification"] is True
        assert r["rule"] is None
        assert any("活跃" in c for c in r["clarifications"])

    def test_vague_with_number_no_clarify(self):
        """带明确时间窗口(7 天)时不再触发硬编码模糊澄清；结合可解析条件应走规则。"""
        r = draft("最近活跃 7 天的上海线索")  # 含"7 天" → 跳过模糊守卫；上海→可解析
        assert r["source"] == "rule"
        assert r["needs_clarification"] is False
        assert {"field": "city", "op": "eq", "value": "上海"} in r["rule"]["conditions"]


class TestConfirm:
    def test_confirm_saves_segment(self):
        rule = {"object": "lead",
                "conditions": [{"field": "city", "op": "eq", "value": "上海"},
                               {"field": "company_size", "op": "gt", "value": 500}],
                "relations": [{"rel_type": "belongs_to", "object": "user",
                               "conditions": [{"field": "tags", "op": "contains", "value": "vip"}]}]}
        resp = S.post(f"{API}/agent/segment/confirm", json={
            "tenant_id": TENANT, "segment_code": "t_nl_confirm",
            "segment_name": "测试NL确认", "rule": rule}, timeout=15)
        assert resp.status_code in (201, 200)
        body = resp.json()
        assert body["source"] == "nl-agent"
        assert body["estimate"] >= 2
        # 回读
        got = S.get(f"{API}/segments/{TENANT}/t_nl_confirm", timeout=10).json()
        assert got["dsl"]["object"] == "lead"

    def test_confirm_invalid_rule_rejected(self):
        resp = S.post(f"{API}/agent/segment/confirm", json={
            "tenant_id": TENANT, "segment_code": "t_nl_bad", "segment_name": "坏",
            "rule": {"object": "lead", "conditions": [{"field": "ghost", "op": "eq", "value": 1}]}}, timeout=10)
        assert resp.status_code == 400


@pytest.mark.skipif(not os.getenv("DEEPSEEK_API_KEY"), reason="需要 DEEPSEEK_API_KEY")
class TestDeepSeekFallback:
    def test_llm_generates_valid_dsl(self):
        r = draft("找出购买过商品的账户")
        assert r["source"] == "deepseek"
        # LLM 必须产出 schema 内合法规则（已通过校验才会带 summary）
        assert r["rule"] is not None
        assert r["rule"]["object"] in ("account", "product")
