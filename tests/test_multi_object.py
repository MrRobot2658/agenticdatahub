"""多对象接入与跨对象筛选测试（V3.0-06 第 3 章）

前置：docker compose up -d mysql redis sql-engine
      bash scripts/apply_migrations.sh   # 应用 migrate_objects.sql
"""

import requests

API = "http://localhost:8002"
# 绕过本机 http_proxy，避免 localhost 被代理
S = requests.Session()
S.trust_env = False
TENANT = 1001


def search(payload: dict) -> dict:
    resp = S.post(f"{API}/objects/search", json={"tenant_id": TENANT, **payload}, timeout=15)
    return resp


class TestObjectMeta:
    def test_meta_lists_five_objects(self):
        data = S.get(f"{API}/objects/meta", timeout=5).json()
        objs = {o["object"] for o in data["objects"]}
        assert objs == {"user", "lead", "account", "product", "store"}

    def test_meta_relation_matrix(self):
        data = S.get(f"{API}/objects/meta", timeout=5).json()
        rels = {(r["src_type"], r["rel_type"], r["dst_type"]) for r in data["relations"]}
        assert ("lead", "belongs_to", "user") in rels
        assert ("account", "purchased", "product") in rels


class TestCrossObjectFilter:
    def test_documented_example(self):
        """上海 & 规模>500 & 关联用户带VIP → 至少含 L2001、L2005"""
        resp = search({
            "object": "lead",
            "conditions": [{"field": "city", "op": "eq", "value": "上海"},
                           {"field": "company_size", "op": "gt", "value": 500}],
            "relations": [{"rel_type": "belongs_to", "object": "user",
                           "conditions": [{"field": "tags", "op": "contains", "value": "vip"}]}],
            "limit": 100,
        })
        assert resp.status_code == 200
        ids = {r["lead_id"] for r in resp.json()["data"]}
        assert {"L2001", "L2005"}.issubset(ids)
        # 反例不应出现：L2002(用户非VIP) / L2003(非上海) / L2004(规模<500)
        assert "L2002" not in ids and "L2003" not in ids and "L2004" not in ids

    def test_estimate_count_only(self):
        resp = search({
            "object": "lead", "count_only": True,
            "conditions": [{"field": "city", "op": "eq", "value": "上海"},
                           {"field": "company_size", "op": "gt", "value": 500}],
            "relations": [{"rel_type": "belongs_to", "object": "user",
                           "conditions": [{"field": "tags", "op": "contains", "value": "vip"}]}],
        })
        assert resp.status_code == 200
        assert resp.json()["estimate"] >= 2

    def test_base_only_filter(self):
        resp = search({"object": "lead",
                       "conditions": [{"field": "city", "op": "eq", "value": "上海"}]})
        assert resp.status_code == 200
        assert resp.json()["row_count"] >= 4

    def test_reverse_relation(self):
        """反向：被 VIP 用户访问过的门店"""
        resp = search({
            "object": "store",
            "relations": [{"rel_type": "visited", "object": "user", "direction": "reverse",
                           "conditions": [{"field": "tags", "op": "contains", "value": "vip"}]}],
        })
        assert resp.status_code == 200
        assert resp.json()["row_count"] >= 1


class TestValidation:
    def test_unknown_field_rejected(self):
        resp = search({"object": "lead", "conditions": [{"field": "nope", "op": "eq", "value": 1}]})
        assert resp.status_code == 400

    def test_hop_limit_rejected(self):
        resp = search({"object": "lead",
                       "relations": [{"rel_type": "belongs_to", "object": "user"}] * 4})
        assert resp.status_code == 400
        assert "3" in resp.json()["detail"]

    def test_undefined_relation_rejected(self):
        resp = search({"object": "lead",
                       "relations": [{"rel_type": "purchased", "object": "product"}]})
        assert resp.status_code == 400


class TestChainedMultiHop:
    """链式多跳：relation 可嵌套，每跳 target 成为下一跳锚点（user→account→product）。"""

    def _chain_owns_purchased(self, product_conditions=None) -> dict:
        inner = {"rel_type": "purchased", "object": "product"}
        if product_conditions is not None:
            inner["conditions"] = product_conditions
        return {"object": "user", "count_only": True,
                "relations": [{"rel_type": "owns", "object": "account", "relations": [inner]}]}

    def test_second_hop_anchored_on_parent_not_base(self):
        """核心回归：第二跳必须锚在上一跳的 account 别名上，而非 base t0。"""
        resp = search(self._chain_owns_purchased())
        assert resp.status_code == 200
        sql = resp.json()["sql"]
        # 第二跳 purchased 的 src_id 锚定在第一跳 account(u1)，证明嵌套未被丢弃
        assert "r2.src_id=u1.account_id" in sql
        assert "object_product u2" in sql

    def test_nested_relation_actually_filters(self):
        """嵌套购买条件应真正收窄结果（旧实现会静默丢弃内层跳）。"""
        owns_only = search({"object": "user", "count_only": True,
                            "relations": [{"rel_type": "owns", "object": "account"}]}).json()["estimate"]
        chained = search(self._chain_owns_purchased()).json()["estimate"]
        assert chained <= owns_only  # 加了"账户买过商品"只会更少或相等
        # 再叠一个 product 条件，不应反而变多
        narrowed = search(self._chain_owns_purchased(
            [{"field": "category", "op": "eq", "value": "数码"}])).json()["estimate"]
        assert narrowed <= chained

    def test_total_hops_over_limit_rejected(self):
        """跳数按整棵关系树统计：链式 4 跳超限拒绝。"""
        resp = search({"object": "user", "relations": [
            {"rel_type": "owns", "object": "account", "relations": [
                {"rel_type": "purchased", "object": "product", "relations": [
                    {"rel_type": "x", "object": "store", "relations": [
                        {"rel_type": "y", "object": "lead"}]}]}]}]})
        assert resp.status_code == 400
        assert "3" in resp.json()["detail"]

    def test_nested_undefined_relation_rejected(self):
        """内层非法关联同样被校验拦截（account-visited->store 未定义）。"""
        resp = search({"object": "user", "relations": [
            {"rel_type": "owns", "object": "account", "relations": [
                {"rel_type": "visited", "object": "store"}]}]})
        assert resp.status_code == 400


class TestEdgeConditions:
    """边条件：作用在 object_relations 行（create_time / properties.<key>），如"购买发生在最近30天"。"""

    def _chain(self, edge_conditions) -> dict:
        return {"object": "user", "count_only": True, "relations": [
            {"rel_type": "owns", "object": "account", "relations": [
                {"rel_type": "purchased", "object": "product",
                 "edge_conditions": edge_conditions}]}]}

    def test_edge_create_time_filters_on_relation_row(self):
        """边条件应编译到关系别名 r2.create_time，而非目标对象。"""
        resp = search(self._chain([{"field": "create_time", "op": "between",
                                    "value": ["2026-05-14", "2026-06-13"]}]))
        assert resp.status_code == 200
        assert "r2.create_time BETWEEN" in resp.json()["sql"]

    def test_edge_window_actually_filters(self):
        """近窗口命中购买、远窗口为 0 —— 证明边时间过滤真生效。"""
        any_purchase = search({"object": "user", "count_only": True, "relations": [
            {"rel_type": "owns", "object": "account", "relations": [
                {"rel_type": "purchased", "object": "product"}]}]}).json()["estimate"]
        # 上界取次日 00:00，含当天整天（避免 date 上界被当成 00:00:00 漏掉当天）
        recent = search(self._chain([{"field": "create_time", "op": "between",
                                      "value": ["2026-05-14", "2026-06-14"]}])).json()["estimate"]
        old = search(self._chain([{"field": "create_time", "op": "between",
                                   "value": ["2020-01-01", "2020-12-31"]}])).json()["estimate"]
        assert recent == any_purchase  # 样例购买发生在今天，落在近窗口内
        assert old == 0

    def test_edge_properties_path(self):
        """properties.<key> 经 JSON_EXTRACT 编译（白名单路径）。"""
        resp = search(self._chain([{"field": "properties.channel", "op": "eq", "value": "app"}]))
        assert resp.status_code == 200
        assert "JSON_EXTRACT(r2.properties" in resp.json()["sql"]

    def test_edge_unknown_field_rejected(self):
        resp = search(self._chain([{"field": "bogus", "op": "eq", "value": 1}]))
        assert resp.status_code == 400


class TestIngestion:
    def test_upsert_and_relate_and_query(self):
        # 接入一条线索 + 关联到 VIP 用户 100002，再筛回来
        S.post(f"{API}/objects/upsert", json={
            "tenant_id": TENANT, "object": "lead",
            "record": {"lead_id": "T9001", "lead_name": "测试线索", "city": "上海",
                       "company_size": 999, "source": "test", "stage": "new"},
        }, timeout=10).raise_for_status()
        S.post(f"{API}/objects/relations", json={
            "tenant_id": TENANT, "src_type": "lead", "src_id": "T9001",
            "rel_type": "belongs_to", "dst_type": "user", "dst_id": "100002",
        }, timeout=10).raise_for_status()
        resp = search({
            "object": "lead",
            "conditions": [{"field": "lead_id", "op": "eq", "value": "T9001"}],
            "relations": [{"rel_type": "belongs_to", "object": "user",
                           "conditions": [{"field": "tags", "op": "contains", "value": "vip"}]}],
        })
        assert resp.status_code == 200
        assert resp.json()["row_count"] == 1
