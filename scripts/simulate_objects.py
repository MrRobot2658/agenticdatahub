#!/usr/bin/env python3
"""多对象数据模拟（V3.0-06 第 3 章）

通过 sql-engine 的 /objects/* 接口接入 User/Lead/Account/Product/Store 与关联边，
然后跑文档示例的跨对象筛选并打印结果与耗时。

用法:
  python3 scripts/simulate_objects.py            # 默认 12 条线索
  python3 scripts/simulate_objects.py --leads 50
"""

import argparse
import json
import urllib.request

# 绕过本机可能存在的 http_proxy，避免 localhost 被代理（502）
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

BASE = "http://localhost:8002"
TENANT = 1001
CITIES = ["上海", "北京", "深圳", "杭州", "广州"]
INDUSTRIES = ["manufacturing", "tech", "retail", "finance"]
CATEGORIES = ["智能家居", "家电", "数码", "办公"]


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    with _OPENER.open(req, timeout=30) as resp:
        return json.loads(resp.read())


def upsert(object_type: str, record: dict):
    return post("/objects/upsert", {"tenant_id": TENANT, "object": object_type, "record": record})


def relate(src_type, src_id, rel_type, dst_type, dst_id):
    return post("/objects/relations", {
        "tenant_id": TENANT, "src_type": src_type, "src_id": str(src_id),
        "rel_type": rel_type, "dst_type": dst_type, "dst_id": str(dst_id),
    })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--leads", type=int, default=12)
    args = ap.parse_args()

    print(f"========== 多对象数据模拟 (租户 {TENANT}) ==========")

    # 用户（关系目标）：一半 VIP
    users = []
    for i in range(6):
        one_id = 200100 + i
        tags = ["vip", "high_value"] if i % 2 == 0 else ["normal"]
        upsert("user", {"one_id": one_id, "phone": f"139000{one_id}", "channel_count": 1,
                        "tags": tags, "properties": {"sim": True}})
        users.append((one_id, "vip" in tags))
    print(f"  用户: {len(users)} (VIP {sum(1 for _,v in users if v)})")

    # 账户 + 商品 + 门店
    for i in range(4):
        upsert("account", {"account_id": f"SA{i}", "name": f"模拟账户{i}",
                           "industry": INDUSTRIES[i % len(INDUSTRIES)], "scale": "large" if i % 2 else "medium"})
        upsert("product", {"product_id": f"SP{i}", "sku": f"SKU-S{i}",
                           "category": CATEGORIES[i % len(CATEGORIES)], "price": 1000 + i * 500})
        upsert("store", {"store_id": f"SS{i}", "store_name": f"模拟门店{i}",
                         "region": "华东" if i % 2 else "华北", "address": f"{CITIES[i % len(CITIES)]}模拟路{i}号"})

    # 线索 + belongs_to user
    for i in range(args.leads):
        lid = f"SL{i:03d}"
        city = CITIES[i % len(CITIES)]
        size = 200 + (i * 137) % 1500
        upsert("lead", {"lead_id": lid, "lead_name": f"{city}模拟线索{i}", "city": city,
                        "company_size": size, "source": "campaign", "stage": "qualified"})
        one_id, _ = users[i % len(users)]
        relate("lead", lid, "belongs_to", "user", one_id)

    # 账户关系：user owns account / account purchased product / user visited store
    for i in range(4):
        relate("user", users[i % len(users)][0], "owns", "account", f"SA{i}")
        relate("account", f"SA{i}", "purchased", "product", f"SP{i}")
        relate("user", users[i % len(users)][0], "visited", "store", f"SS{i}")
    print(f"  线索: {args.leads} | 账户/商品/门店: 各 4")

    # 文档示例筛选
    print("\n========== 跨对象筛选：上海 & 规模>500 & 关联用户VIP ==========")
    res = post("/objects/search", {
        "tenant_id": TENANT, "object": "lead",
        "conditions": [{"field": "city", "op": "eq", "value": "上海"},
                       {"field": "company_size", "op": "gt", "value": 500}],
        "relations": [{"rel_type": "belongs_to", "object": "user",
                       "conditions": [{"field": "tags", "op": "contains", "value": "vip"}]}],
        "limit": 100,
    })
    print(f"  命中 {res['row_count']} 条，耗时 {res['elapsed_ms']}ms")
    for r in res["data"][:10]:
        print(f"    {r['lead_id']} {r['lead_name']} {r['city']} size={r['company_size']}")

    print("\n========== 人数预估 (count_only) ==========")
    est = post("/objects/search", {
        "tenant_id": TENANT, "object": "lead",
        "conditions": [{"field": "city", "op": "eq", "value": "上海"},
                       {"field": "company_size", "op": "gt", "value": 500}],
        "relations": [{"rel_type": "belongs_to", "object": "user",
                       "conditions": [{"field": "tags", "op": "contains", "value": "vip"}]}],
        "count_only": True,
    })
    print(f"  预估人数 {est['estimate']}，耗时 {est['elapsed_ms']}ms")


if __name__ == "__main__":
    main()
