"""SQL Engine OLAP 查询层测试"""

import os

import pytest
import requests

API = "http://localhost:8002"


class TestSqlEngine:
    def test_health(self):
        resp = requests.get(f"{API}/health", timeout=5)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["executor"]["status"] == "ok"

    def test_list_templates(self):
        resp = requests.get(f"{API}/templates", timeout=5)
        assert resp.status_code == 200
        names = {t["name"] for t in resp.json()["templates"]}
        assert "profile_by_one_id" in names
        assert "profile_by_phone" in names

    def test_profile_by_one_id(self):
        resp = requests.post(
            f"{API}/query/profile_by_one_id",
            json={"params": {"tenant_id": 1001, "one_id": 100001}},
            timeout=10,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["row_count"] >= 1
        assert body["data"][0]["one_id"] == 100001

    def test_profile_by_phone_get(self):
        resp = requests.get(
            f"{API}/query/profile_by_phone",
            params={"tenant_id": 1001, "phone": "13800138001"},
            timeout=10,
        )
        assert resp.status_code == 200
        assert resp.json()["row_count"] >= 1

    def test_missing_param_rejected(self):
        resp = requests.post(
            f"{API}/query/profile_by_one_id",
            json={"params": {"tenant_id": 1001}},
            timeout=5,
        )
        assert resp.status_code == 400


class TestNlQuery:
    def test_health_shows_nl_query(self):
        resp = requests.get(f"{API}/health", timeout=5)
        assert "nl_query" in resp.json()

    def test_nl_query_by_phone_rule(self):
        """规则匹配：手机号查画像（无需调 DeepSeek）"""
        resp = requests.post(
            f"{API}/nl-query",
            json={
                "question": "查一下手机号13800138001的用户画像",
                "tenant_id": 1001,
            },
            timeout=15,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["plan"]["template"] == "profile_by_phone"
        assert body["plan"]["source"] == "rule"
        assert body["result"]["row_count"] >= 1

    def test_nl_query_by_one_id_rule(self):
        resp = requests.post(
            f"{API}/nl-query",
            json={"question": "OneID 100001 的用户宽表", "tenant_id": 1001},
            timeout=15,
        )
        assert resp.status_code == 200
        assert resp.json()["plan"]["template"] == "profile_by_one_id"

    @pytest.mark.skipif(not os.getenv("DEEPSEEK_API_KEY"), reason="需要 DEEPSEEK_API_KEY")
    def test_nl_query_deepseek_complex(self):
        """复杂语义走 DeepSeek（需 API Key）"""
        resp = requests.post(
            f"{API}/nl-query",
            json={
                "question": "帮我找出这个租户最近更新过画像的高价值客户，先看20个",
                "tenant_id": 1001,
            },
            timeout=60,
        )
        assert resp.status_code == 200
        assert resp.json()["plan"]["source"] == "deepseek"
