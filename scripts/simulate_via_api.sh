#!/bin/bash
# 通过 API 模拟多渠道用户实时合并（无需本机安装 kafka-python）

BASE="http://localhost:8001"
TENANT=1001

send() {
  local desc="$1"
  local payload="$2"
  echo ""
  echo "[$desc]"
  curl -s -X POST "$BASE/events/process" \
    -H "Content-Type: application/json" \
    -d "$payload" | python3 -m json.tool 2>/dev/null || \
  curl -s -X POST "$BASE/events/process" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

echo "========== 多渠道用户实时合并模拟 (API) =========="
echo "租户: $TENANT"

send "Step1 微信小程序匿名访问" '{
  "tenant_id": 1001,
  "channel_type": "wechat_openid",
  "channel_id": "oXxx_sim_user_001",
  "event_type": "page_view",
  "properties": {"page": "home", "order_count": 1, "amount": 99}
}'

send "Step2 微信授权登录 (openid+unionid)" '{
  "tenant_id": 1001,
  "channel_type": "wechat_openid",
  "channel_id": "oXxx_sim_user_001",
  "event_type": "login",
  "link_keys": {"wechat_unionid": "union_sim_abc001"},
  "properties": {"login_method": "wechat_auth", "order_count": 2, "amount": 299}
}'

send "Step3 手机号绑定 (phone+unionid)" '{
  "tenant_id": 1001,
  "channel_type": "phone",
  "channel_id": "13900001111",
  "event_type": "register",
  "link_keys": {"wechat_unionid": "union_sim_abc001"},
  "properties": {"register_source": "mini_program", "order_count": 3, "amount": 1500}
}'

send "Step4 企微添加好友 (wework+phone)" '{
  "tenant_id": 1001,
  "channel_type": "wework_extid",
  "channel_id": "wmSimExt001",
  "event_type": "add_friend",
  "link_keys": {"phone": "13900001111"},
  "properties": {"wework_tag": "VIP", "order_count": 5, "amount": 8800}
}'

send "Step5 App设备活跃 (device+email+phone)" '{
  "tenant_id": 1001,
  "channel_type": "device",
  "channel_id": "device_ios_abc123",
  "event_type": "app_launch",
  "link_keys": {"email": "simuser@example.com", "phone": "13900001111"},
  "properties": {"app_version": "3.2.1", "order_count": 8, "amount": 15000}
}'

send "Step6 冲突合并 (另一openid绑定同一手机)" '{
  "tenant_id": 1001,
  "channel_type": "wechat_openid",
  "channel_id": "oXxx_sim_user_002_conflict",
  "event_type": "bind_phone",
  "link_keys": {"phone": "13900001111"},
  "properties": {"bind_source": "another_mini_program"}
}'

echo ""
echo "========== 模拟完成，查询结果 =========="
bash "$(dirname "$0")/query_status.sh" $TENANT
