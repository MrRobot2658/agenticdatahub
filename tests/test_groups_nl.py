"""用户分组 + 自然语言查询测试"""

import requests

API = "http://localhost:8002"


class TestUserGroups:
    def test_list_groups(self):
        resp = requests.get(f"{API}/groups/1001", timeout=5)
        assert resp.status_code == 200
        groups = resp.json()
        assert len(groups) >= 3
        codes = {g["group_code"] for g in groups}
        assert "vip_high_value" in codes

    def test_get_group_by_code(self):
        resp = requests.get(f"{API}/groups/1001/code/vip_high_value", timeout=5)
        assert resp.status_code == 200
        assert resp.json()["group_name"] == "VIP高价值用户"

    def test_list_group_members(self):
        resp = requests.get(f"{API}/groups/1001/1001/members", timeout=5)
        assert resp.status_code == 200
        members = resp.json()
        assert any(m["one_id"] == 100001 for m in members)

    def test_get_user_with_groups(self):
        resp = requests.get(f"{API}/users/1001/100001", timeout=5)
        assert resp.status_code == 200
        user = resp.json()
        assert user["one_id"] == 100001
        assert "vip_high_value" in user["groups"]
        assert "wechat_users" in user["groups"]

    def test_user_groups_endpoint(self):
        resp = requests.get(f"{API}/users/1001/100001/groups", timeout=5)
        assert resp.status_code == 200
        assert len(resp.json()) >= 2

    def test_add_and_remove_member(self):
        # 加到 form_leads 分组
        resp = requests.post(
            f"{API}/groups/1001/1003/members",
            json={"one_id": 100001, "source": "test"},
            timeout=5,
        )
        assert resp.status_code == 200

        resp = requests.get(f"{API}/groups/1001/1003/members", timeout=5)
        assert any(m["one_id"] == 100001 for m in resp.json())

        resp = requests.delete(f"{API}/groups/1001/1003/members/100001", timeout=5)
        assert resp.status_code == 200


class TestNlQueryGroups:
    def test_nl_group_list(self):
        resp = requests.post(
            f"{API}/nl-query",
            json={"question": "租户1001有哪些分组", "tenant_id": 1001},
            timeout=15,
        )
        assert resp.status_code == 200
        assert resp.json()["plan"]["template"] == "group_list"
        assert resp.json()["result"]["row_count"] >= 3

    def test_nl_group_members_by_code(self):
        resp = requests.post(
            f"{API}/nl-query",
            json={"question": "分组vip_high_value有哪些成员", "tenant_id": 1001},
            timeout=15,
        )
        assert resp.status_code == 200
        assert resp.json()["plan"]["template"] == "group_members_by_code"
        assert resp.json()["result"]["row_count"] >= 1

    def test_nl_user_groups(self):
        resp = requests.post(
            f"{API}/nl-query",
            json={"question": "用户100001属于哪些分组", "tenant_id": 1001},
            timeout=15,
        )
        assert resp.status_code == 200
        assert resp.json()["plan"]["template"] == "user_groups"
        assert resp.json()["result"]["row_count"] >= 2

    def test_nl_query_user_summary_via_template(self):
        resp = requests.post(
            f"{API}/nl-query",
            json={"question": "OneID 100001 的用户宽表", "tenant_id": 1001},
            timeout=15,
        )
        assert resp.status_code == 200
        assert resp.json()["plan"]["template"] == "profile_by_one_id"


class TestSwagger:
    def test_sql_engine_openapi(self):
        resp = requests.get(f"{API}/openapi.json", timeout=5)
        assert resp.status_code == 200
        spec = resp.json()
        assert spec["info"]["title"] == "SQL Engine API"
        paths = spec["paths"]
        assert "/nl-query" in paths
        assert "/groups/{tenant_id}" in paths
        assert "/users/{tenant_id}/{one_id}" in paths

    def test_id_mapping_openapi(self):
        resp = requests.get("http://localhost:8001/openapi.json", timeout=5)
        assert resp.status_code == 200
        assert resp.json()["info"]["title"] == "ID-Mapping API"
