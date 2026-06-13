"""DSL 验证层测试（V3.0-06 Ch4.1–4.3）

前置：docker compose up -d mysql redis sql-engine
      bash scripts/apply_migrations.sh
"""

import requests

API = "http://localhost:8002"
S = requests.Session()
S.trust_env = False  # 绕过本机 http_proxy
TENANT = 1001

RULE = {
    "tenant_id": TENANT, "object": "lead", "logic": "AND",
    "conditions": [{"field": "city", "op": "eq", "value": "上海"},
                   {"field": "company_size", "op": "gt", "value": 500}],
    "relations": [{"rel_type": "belongs_to", "object": "user",
                   "conditions": [{"field": "tags", "op": "contains", "value": "vip"}]}],
}


class TestMetadata:
    def test_fields_for_object(self):
        data = S.get(f"{API}/metadata/{TENANT}/fields", params={"object": "lead"}, timeout=5).json()
        codes = {f["code"] for f in data["objects"][0]["fields"]}
        assert {"city", "company_size", "stage"}.issubset(codes)

    def test_unknown_object_404(self):
        assert S.get(f"{API}/metadata/{TENANT}/fields", params={"object": "ghost"}, timeout=5).status_code == 404


class TestValidate:
    def test_valid_rule(self):
        r = S.post(f"{API}/dsl/validate", json=RULE, timeout=10).json()
        assert r["ok"] is True and r["errors"] == []

    def test_unknown_field(self):
        bad = {**RULE, "conditions": [{"field": "ghost", "op": "eq", "value": 1}], "relations": []}
        r = S.post(f"{API}/dsl/validate", json=bad, timeout=10).json()
        assert r["ok"] is False and any("ghost" in e for e in r["errors"])

    def test_hop_limit(self):
        bad = {**RULE, "relations": [{"rel_type": "belongs_to", "object": "user"}] * 4}
        r = S.post(f"{API}/dsl/validate", json=bad, timeout=10).json()
        assert r["ok"] is False

    def test_undefined_relation(self):
        bad = {**RULE, "relations": [{"rel_type": "purchased", "object": "product"}]}
        r = S.post(f"{API}/dsl/validate", json=bad, timeout=10).json()
        assert r["ok"] is False


class TestEcho:
    def test_echo_summary_and_explanations(self):
        r = S.post(f"{API}/dsl/echo", json=RULE, timeout=10).json()
        assert "线索" in r["summary"] and "归属于" in r["summary"]
        # 3 个叶子条件（city、company_size、tags）
        assert len(r["conditions"]) == 3
        fields = {c["field"] for c in r["conditions"]}
        assert {"city", "company_size", "tags"} == fields


class TestCompile:
    def test_compile_returns_sql_no_exec(self):
        r = S.post(f"{API}/dsl/compile", json=RULE, timeout=10).json()
        assert r["sql"].strip().upper().startswith("SELECT DISTINCT")
        assert "object_relations" in r["sql"]

    def test_compile_count_only(self):
        r = S.post(f"{API}/dsl/compile", params={"count_only": "true"}, json=RULE, timeout=10).json()
        assert "COUNT(" in r["sql"].upper()


class TestEstimate:
    def test_estimate_count(self):
        r = S.post(f"{API}/dsl/estimate", json=RULE, timeout=10).json()
        assert r["estimate"] >= 2  # 至少 L2001、L2005
        assert "elapsed_ms" in r


class TestNestedLogic:
    def test_or_group_estimate_superset(self):
        """OR 组：上海 OR 北京 应 >= 仅上海"""
        only_sh = {"tenant_id": TENANT, "object": "lead",
                   "conditions": [{"field": "city", "op": "eq", "value": "上海"}]}
        or_rule = {"tenant_id": TENANT, "object": "lead",
                   "conditions": [{"logic": "OR", "conditions": [
                       {"field": "city", "op": "eq", "value": "上海"},
                       {"field": "city", "op": "eq", "value": "北京"}]}]}
        e_sh = S.post(f"{API}/dsl/estimate", json=only_sh, timeout=10).json()["estimate"]
        e_or = S.post(f"{API}/dsl/estimate", json=or_rule, timeout=10).json()["estimate"]
        assert e_or >= e_sh >= 1


class TestSegments:
    def test_save_and_get(self):
        save = S.post(f"{API}/segments", json={
            "tenant_id": TENANT, "segment_code": "t_sh_vip", "segment_name": "测试上海VIP",
            "dsl": {k: v for k, v in RULE.items() if k != "tenant_id"},
        }, timeout=15)
        assert save.status_code in (201, 200)
        body = save.json()
        assert body["estimate"] >= 2
        got = S.get(f"{API}/segments/{TENANT}/t_sh_vip", timeout=10).json()
        assert got["segment_name"] == "测试上海VIP"
        assert got["dsl"]["object"] == "lead"

    def test_save_invalid_dsl_rejected(self):
        resp = S.post(f"{API}/segments", json={
            "tenant_id": TENANT, "segment_code": "t_bad", "segment_name": "坏规则",
            "dsl": {"object": "lead", "conditions": [{"field": "ghost", "op": "eq", "value": 1}]},
        }, timeout=10)
        assert resp.status_code == 400
