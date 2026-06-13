# 多租户实时ID\-Mapping \+ 画像水平伸缩方案

**多租户实时 ID\-Mapping \+ 画像水平伸缩方案**



**一、方案总览**



核心目标：

1\. 租户数据物理隔离 \+ 逻辑隔离

2\. 按租户数据量水平伸缩（小租户共享、大租户独占）

3\. 租户内多渠道实时 ID 打通（OneID）

4\. 用户画像实时更新，秒级响应



**总体架构：**

```
┌─────────────────────────────────────────────────────────┐
│                    StreamPark 管控面                       │
│  租户A Flink Job  │  租户B Flink Job  │  租户C Flink Job  │
└────────┬──────────────────┬──────────────────┬───────────┘
         │                  │                  │
    ┌────▼────┐        ┌────▼────┐        ┌────▼────┐
    │ Kafka   │        │ Kafka   │        │ Kafka   │
    │ Topic-A │        │ Topic-B │        │ Topic-C │
    └────┬────┘        └────┬────┘        └────┬────┘
         │                  │                  │
    ┌────▼──────────────────▼──────────────────▼────┐
    │              Apache Doris (OLAP)               │
    │  tenant_a.user_profile │ tenant_b.user_profile │
    │  物理隔离（大租户）     │  逻辑隔离（小租户）    │
    └────────────────────────────────────────────────┘
```



**二、多租户隔离策略**



**2\.1 三层隔离模型**

Layer 1 · Kafka 隔离：每个租户独立 Topic（tenant\-\{id\}\-events）

Layer 2 · Flink 隔离：每个租户独立 Flink Job（共享集群或独立集群）

Layer 3 · Doris 隔离：大租户物理隔离、小租户逻辑隔离



**2\.2 Doris 表设计（混合隔离）**

```
-- 方案A：大租户物理隔离（> 1亿用户）
CREATE TABLE tenant_large.user_profile (
  user_id BIGINT,          -- OneID（租户内唯一）
  channel_type VARCHAR(32),-- 渠道类型
  channel_id VARCHAR(128), -- 渠道原始ID
  tags BITMAP,             -- 标签位图
  properties JSON,         -- 扩展属性
  update_time DATETIME
) UNIQUE KEY(user_id)
DISTRIBUTED BY HASH(user_id) BUCKETS 32;

-- 方案B：小租户逻辑隔离（< 1000万用户，共享表 + tenant_id过滤）
CREATE TABLE tenant_shared.user_profile (
  tenant_id BIGINT,        -- 租户ID（分区键）
  user_id BIGINT,          -- OneID
  channel_type VARCHAR(32),
  channel_id VARCHAR(128),
  tags BITMAP,
  properties JSON,
  update_time DATETIME
) UNIQUE KEY(tenant_id, user_id)
PARTITION BY LIST(tenant_id) ()  -- 动态分区
DISTRIBUTED BY HASH(tenant_id, user_id) BUCKETS 16;
```



**2\.3 租户路由策略**

```
// Node.js 中间层：根据租户配置路由到正确的 Doris 表
function getProfileTable(tenantId) {
  const config = await getTenantConfig(tenantId);
  if (config.tier === 'premium') {
    // 大租户：独立数据库
    return `tenant_${tenantId}.user_profile`;
  } else {
    // 小租户：共享表 + tenant_id 过滤
    return `tenant_shared.user_profile WHERE tenant_id = ${tenantId}`;
  }
}
```



**三、实时 ID\-Mapping 方案**



**3\.1 ID\-Mapping 核心逻辑**

多渠道 ID 关联 → 统一 OneID 的过程：

▸ 小程序 OpenID ↔ 公众号 UnionID ↔ 企微 external\_userid ↔ 手机号 ↔ 邮箱 ↔ 设备ID

▸ 实时识别：同一用户在不同渠道的行为关联到同一个 OneID

▸ 离线/实时混合：离线全量 ID 打通 \+ 实时增量关联



**3\.2 ID\-Mapping 表设计（Redis \+ Doris 双层）**

**Redis 热层（实时查询，\<1ms）：**

```
# Redis Key 设计
# 任意渠道ID → OneID 映射
SET channel:wechat:openid:oXxx123 -> "uid_456"
SET channel:wework:extid:wmXxx -> "uid_456"
SET channel:phone:13800138000 -> "uid_456"

# OneID → 所有渠道ID（用于反向查询）
HMSET uid:456:channels
  wechat_openid oXxx123
  wework_extid wmXxx
  phone 13800138000
  email user@example.com

# TTL: 30天（冷数据淘汰到 Doris）
EXPIRE channel:wechat:openid:oXxx123 2592000
```



**Doris 冷层（全量 ID 映射，秒级查询）：**

```
CREATE TABLE id_mapping (
  tenant_id BIGINT,
  channel_type VARCHAR(32),  -- wechat/wework/phone/email/device
  channel_id VARCHAR(256),    -- 渠道原始ID
  one_id BIGINT,              -- 统一用户ID
  confidence DOUBLE,          -- 置信度 0-1
  source VARCHAR(32),         -- 关联来源(登录/同设备/同IP/算法)
  create_time DATETIME,
  update_time DATETIME
) UNIQUE KEY(tenant_id, channel_type, channel_id)
DISTRIBUTED BY HASH(tenant_id, channel_type, channel_id) BUCKETS 16;

-- 倒排索引加速
ALTER TABLE id_mapping ADD INDEX idx_one_id (one_id) USING INVERTED;
```



**3\.3 Flink 实时 ID\-Mapping Job**

```
// Flink DataStream API: 实时 ID 关联
DataStream<UserEvent> events = env
  .addSource(new FlinkKafkaConsumer<>("user-events", ...))
  .keyBy(e -> e.channelId)
  .process(new KeyedProcessFunction<>() {
    private transient RedisClient redis;
    private ValueState<String> oneIdState;

    void processElement(UserEvent e, Context ctx, Collector<EnrichedEvent> out) {
      // 1. 查 Redis 缓存（<1ms）
      String oneId = redis.get(
        "channel:" + e.channelType + ":" + e.channelId
      );
      
      if (oneId == null) {
        // 2. Redis miss → 查 Doris（秒级）
        oneId = queryDoris(e.tenantId, e.channelType, e.channelId);
        if (oneId != null) {
          redis.setex(key, 2592000, oneId);  // 回填Redis
        } else {
          // 3. 新用户 → 生成新 OneID
          oneId = generateOneId(e.tenantId);
          insertIdMapping(e.tenantId, e.channelType, e.channelId, oneId);
          redis.setex(key, 2592000, oneId);
        }
      }
      
      // 4. 输出富化后的事件（带 OneID）
      out.collect(new EnrichedEvent(oneId, e));
    }
  });
```



**四、水平伸缩策略**



**4\.1 伸缩维度**

▸ Kafka：按租户独立 Topic → Consumer Group 按需增减

▸ Flink：每个租户独立 Job → StreamPark 按需启动/停止/调整并行度

▸ Doris：大租户独立 BE 节点组（Resource Tag），小租户共享

▸ Redis：大租户独立实例，小租户共享实例 \+ 前缀隔离



**4\.2 Doris Resource Tag（物理隔离大租户）**

```
-- 为大租户分配专属 BE 节点
ALTER SYSTEM MODIFY BACKEND "be_host:9050"
  SET ("tag.location" = "tenant_large_a");

-- 创建表时指定 resource tag
CREATE TABLE tenant_large_a.user_profile (...) 
DISTRIBUTED BY HASH(user_id) BUCKETS 32
PROPERTIES (
  "replication_allocation" = "tag.location.tenant_large_a: 2"
);
```



**4\.3 Kafka Topic 规划（按租户\+数据量分级）**

```
# 大租户：独立 Topic，更多分区
kafka-topics.sh --create \
  --topic tenant-{id}-events \
  --partitions 16 \
  --replication-factor 3

# 小租户：共享 Topic，按 tenant_id 分区
kafka-topics.sh --create \
  --topic shared-tenant-events \
  --partitions 8 \
  --replication-factor 2

# 小租户 Producer 指定 tenant_id 为 key
producer.send(new ProducerRecord<>(
  "shared-tenant-events",
  tenantId,    // key = tenant_id → 同一租户到同一分区
  eventJson
));
```



**五、用户画像实时更新链路**



**完整数据流：**

```
# 步骤1: 行为数据采集
用户行为 → Kafka (tenant-{id}-events)

# 步骤2: Flink 实时处理
Kafka → Flink ID-Mapping → 标签计算 → 画像聚合

# 步骤3: 写入 Doris
Flink → Doris UNIQUE KEY 模型（Upsert）

# 步骤4: Redis 热缓存
Flink → Redis（最新画像数据，<1ms 查询）
```



**Flink SQL 标签计算示例：**

```
-- 实时计算用户标签，写入 Doris 画像表
INSERT INTO tenant_large_a.user_profile
SELECT
  one_id AS user_id,
  'wechat' AS channel_type,
  MAX_BY(channel_id, event_time) AS channel_id,
  TO_BITMAP(
    CONCAT(
      IF(SUM(cnt) > 100, 'high_active,', 'low_active,'),
      IF(MAX_BY(amount, event_time) > 10000, 'high_value,', 'low_value,'),
      'last_', CAST(MAX(event_time) AS STRING)
    )
  ) AS tags,
  JSON_OBJECT(
    'total_orders', CAST(COUNT(DISTINCT order_id) AS STRING),
    'total_amount', CAST(SUM(amount) AS STRING),
    'last_login', CAST(MAX(event_time) AS STRING),
    'preferred_category', CAST(MAX_BY(category, cnt) AS STRING)
  ) AS properties,
  MAX(event_time) AS update_time
FROM tenant_large_a.user_events
GROUP BY one_id;
```



**六、查询性能保证**



▸ Redis 缓存层：OneID 查询 \<1ms，画像查询 \<5ms

▸ Doris 点查：P50 \<5ms（倒排索引 \+ Bloom Filter）

▸ Doris 标签圈选：1\-3s（向量化引擎 \+ 分区裁剪）

▸ 租户隔离保证：大租户独占资源，小租户共享但 tenant\_id 过滤生效



**七、运维监控**



▸ StreamPark 监控：每个租户的 Flink Job 状态、吞吐量、延迟

▸ Doris 监控：租户级别 QPS、查询延迟、存储量

▸ Kafka 监控：Topic 级别消息积压、消费延迟

▸ 告警：租户级别 SLA 告警（查询超时、Job 失败、数据延迟）



**八、技术选型总结**



组件      \| 选型          \| 角色

消息队列  \| Kafka         \| 多租户事件总线

流计算    \| Flink         \| 实时 ID\-Mapping \+ 标签计算

OLAP数仓  \| Doris         \| 画像存储 \+ 标签圈选

热缓存    \| Redis         \| OneID映射 \+ 热点画像

管理平台  \| StreamPark    \| Flink Job 多租户管理

BI        \| 观远 BI       \| 画像报表 \+ 自助分析



\-\-\-

文档版本: v1\.0 \| 多租户实时ID\-Mapping \+ 画像伸缩方案

