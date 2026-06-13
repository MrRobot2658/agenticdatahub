# 多租户实时 ID-Mapping 开发环境

基于 [方案文档](./docs/多租户实时ID-Mapping%20+%20画像水平伸缩方案.md) 搭建的本地 Docker Compose 开发环境。

> **生产设计文档**：[docs/design.md](./docs/design.md)（Kafka / Flink / MySQL / Doris 宽表）  
> **规模扩展对照**：[docs/scale-comparison.md](./docs/scale-comparison.md)（dev → 2亿）  
> **Flink Job 模板**：[docs/flink/](./docs/flink/README.md)

## 架构

```
用户行为事件
    │
    ▼
┌─────────┐     ┌──────────────────┐     ┌─────────┐
│  Kafka  │ ──▶ │  ID-Mapping 服务  │ ──▶ │  Redis  │  热层 (<1ms)
│ (多租户) │     │  (模拟 Flink Job) │     └─────────┘
└─────────┘     │                  │     ┌─────────┐
                │                  │ ──▶ │  MySQL  │  冷层 + 业务库
                └──────────────────┘     └─────────┘
```

## 组件

| 组件 | 端口 | 说明 |
|------|------|------|
| MySQL 8 | 3308 | 业务库：id_mapping / user_profile / merge_log |
| Redis 7 | 6381 | OneID 热缓存 |
| Kafka | 9094 | 多租户事件总线 |
| Kafka UI | 8083 | Topic 可视化 |
| **Nginx 网关** | **8080** | **首页 + 用户应用 + API 路由代理** |
| **用户应用** | **8080/app/** | **用户列表 / 群组 / 标签 + 创建 + 导入 + 自然语义搜索** |
| ID-Mapping | 8001 | 实时合并服务 API |
| SQL Engine | 8002 | OLAP 查询层（模板 SQL + 参数拼装，与 Doris 解耦） |

网关路由（`http://localhost:8080`）：

| 路径 | 目标 |
|------|------|
| `/` | 首页（服务导航） |
| `/app/` | 用户应用（列表 / 群组 / 标签 / 创建 / 导入） |
| `/ID-Mapping` | ID-Mapping Swagger → `/docs` |
| `/SQL Engine` | SQL Engine Swagger → `/docs` |
| `/nl-query` 等 | SQL Engine API 根路径直通（Swagger Try it out 兼容） |

## 快速启动

```bash
# 1. 启动全部服务（默认 dev 规模）
docker compose up -d --build

# 或按数据量模拟服务器集群
bash scripts/scale-up.sh dev      # <1万
bash scripts/scale-up.sh large    # 1亿（多 Kafka/Redis 节点）
bash scripts/scale-up.sh xlarge   # 2亿

# 2. 等待服务就绪（约 30-60 秒）
docker compose ps

# 3. 运行多渠道合并模拟

# 方式A: 走完整 Kafka 链路（推荐，含租户 1001 + 1002）
bash scripts/simulate_kafka.sh

# 方式B: 直接调 API（跳过 Kafka）
bash scripts/simulate_via_api.sh

# 4. 查看合并结果
bash scripts/query_status.sh 1001
bash scripts/query_status.sh 1002
```

## 模拟场景

### 租户 1001（品牌A，Topic `tenant-1001-events`）

| 步骤 | 渠道 | 说明 |
|------|------|------|
| 1 | 微信小程序 openid | 匿名访问，创建新 OneID |
| 2 | 微信 unionid | 授权登录，关联 openid |
| 3 | 手机号 | 注册绑定，通过 unionid 合并 |
| 4 | 企微 external_userid | 添加好友，通过 phone 合并 |
| 5 | App 设备 ID | 通过 email + phone 合并 |
| 6 | 冲突 openid | 另一 openid 绑定同一手机，触发 merge |

### 租户 1002（品牌B，Topic `tenant-1002-events`）

| 步骤 | 渠道 | 说明 |
|------|------|------|
| 1 | 微信 openid | H5 页面访问，创建新 OneID |
| 2 | 手机号 | 短信登录，通过 openid 合并 |
| 3 | 邮箱 | 订阅通知，通过 phone 合并 |
| 4 | 设备 ID | App 活跃，通过 email 合并 |

## SQL Engine（OLAP 查询层）

```bash
# 查看可用查询模板
curl http://localhost:8002/templates

# 按 OneID 查画像宽表
curl -X POST http://localhost:8002/query/profile_by_one_id \
  -H "Content-Type: application/json" \
  -d '{"params": {"tenant_id": 1001, "one_id": 100001}}'

# 按手机号查画像
curl "http://localhost:8002/query/profile_by_phone?tenant_id=1001&phone=13800138001"

# 宽表联合映射查询
curl -X POST http://localhost:8002/query/wide_join_mapping \
  -d '{"params": {"tenant_id": 1001, "one_id": 100001}}'

# 自然语义查询（DeepSeek 意图识别 → 模板 SQL → 执行）
# 经网关（推荐）
curl -X POST http://localhost:8080/nl-query \
  -H "Content-Type: application/json" \
  -d '{"question": "查手机号13800138001的用户画像", "tenant_id": 1001}'

# 或直连 SQL Engine
curl -X POST http://localhost:8002/nl-query \
  -H "Content-Type: application/json" \
  -d '{"question": "查手机号13800138001的用户画像", "tenant_id": 1001}'

# 自然语言查分组
curl -X POST http://localhost:8002/nl-query \
  -d '{"question": "分组vip_high_value有哪些成员", "tenant_id": 1001}'

# 用户 + 分组
curl http://localhost:8002/users/1001/100001
curl http://localhost:8002/groups/1001
```

配置 DeepSeek：复制 `.env.example` → `.env`，填入 `DEEPSEEK_API_KEY`（已在 `.gitignore` 中忽略）。

切换真实 Doris：设置 `OLAP_BACKEND=doris OLAP_HOST=doris-fe OLAP_PORT=9030`。

## Swagger API 文档

推荐通过网关访问：

| 服务 | 网关（推荐） | 直连 |
|------|-------------|------|
| 首页 | http://localhost:8080/ | — |
| ID-Mapping | http://localhost:8080/ID-Mapping/docs | http://localhost:8001/docs |
| SQL Engine | http://localhost:8080/SQL%20Engine/docs | http://localhost:8002/docs |

```bash
bash scripts/generate_swagger.sh   # 导出 docs/swagger/*.openapi.json
```

## API 接口

```bash
# 健康检查
curl http://localhost:8001/health

# 查询渠道 → OneID
curl http://localhost:8001/mapping/1001/phone/13900001111

# 查询用户画像
curl http://localhost:8001/profile/1001/100002

# 查看合并日志
curl http://localhost:8001/merge-log/1001

# 手动发送事件（不走 Kafka）
curl -X POST http://localhost:8001/events/process \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": 1002,
    "channel_type": "phone",
    "channel_id": "13800002222",
    "link_keys": {"email": "user@brand-b.com"},
    "properties": {"amount": 500}
  }'
```

## MySQL 连接

```
Host:     localhost:3308
Database: datalake
User:     datalake
Password: datalake123
```

核心表：

- `tenants` — 租户配置（大租户独立 Topic，小租户共享 Topic）
- `id_mapping` — 渠道 ID → OneID 映射
- `user_profile` — 用户画像
- `user_groups` / `user_group_members` — 用户分组（人群包）与成员
- `merge_log` — 合并操作日志

## 预置数据

租户 1001 已预置离线映射：

- `wechat_unionid: union_abc123` → OneID `100001`
- `wechat_openid: oXxx_offline_001` → OneID `100001`
- `phone: 13800138001` → OneID `100001`

## 停止与清理

```bash
docker compose down        # 停止
docker compose down -v     # 停止并清除数据卷
```
