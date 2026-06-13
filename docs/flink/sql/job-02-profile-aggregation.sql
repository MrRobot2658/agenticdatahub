-- =============================================================================
-- Job-2: 用户画像实时聚合（Flink SQL）
-- Source: enriched-1001-events
-- Sink:   Doris tenant_1001.user_profile
--
-- 职责:
--   - 属性实时 merge（MAX_BY 取最新）
--   - 行为实时汇总（last_behavior / last_channel）
--   - 标签计算（high_value / high_active）
-- =============================================================================

-- 前置: 先执行 job-01-ddl-connectors.sql

-- 临时视图：解析 properties JSON 中的数值字段
CREATE TEMPORARY VIEW enriched_parsed AS
SELECT
    tenant_id,
    one_id                                              AS user_id,
    channel_type,
    channel_id,
    event_type,
    event_time,
    properties,
    -- 从 JSON 字符串提取关键指标（按实际 JSON 函数调整）
    CAST(JSON_VALUE(properties, '$.amount')       AS DOUBLE)  AS amount,
    CAST(JSON_VALUE(properties, '$.order_count') AS INT)    AS order_count,
    JSON_VALUE(properties, '$.form_name')                     AS form_name,
    JSON_VALUE(properties, '$.nickname')                      AS nickname
FROM kafka_enriched_events_source
WHERE tenant_id = 1001;

-- 画像聚合写入 Doris
INSERT INTO doris_user_profile
SELECT
    user_id,
    MAX_BY(channel_type, event_time)                    AS channel_type,
    MAX_BY(channel_id, event_time)                      AS channel_id,

    -- 标签：逗号分隔，Doris 入库后转 BITMAP
    CONCAT_WS(',',
        IF(MAX(amount) > 10000,  'high_value',  NULL),
        IF(MAX(order_count) > 10, 'high_active', NULL)
    )                                                   AS tags,

    -- 属性 + 行为汇总 JSON
    JSON_OBJECT(
        'amount',        CAST(MAX(amount) AS STRING),
        'order_count',   CAST(MAX(order_count) AS STRING),
        'form_name',     MAX(form_name),
        'nickname',      MAX(nickname),
        'last_behavior', MAX_BY(event_type, event_time),
        'last_channel',  MAX_BY(channel_type, event_time),
        'event_count',   CAST(COUNT(*) AS STRING)
    )                                                   AS properties,

    MAX(event_time)                                     AS update_time
FROM enriched_parsed
GROUP BY tenant_id, user_id;

-- =============================================================================
-- 变体：带 1 分钟滚动窗口的行为计数（可选）
-- =============================================================================
/*
INSERT INTO doris_user_profile
SELECT
    user_id,
    MAX_BY(channel_type, event_time) AS channel_type,
    MAX_BY(channel_id, event_time)   AS channel_id,
    CONCAT_WS(',', ...)              AS tags,
    JSON_OBJECT(...)                 AS properties,
    MAX(event_time)                  AS update_time
FROM TABLE(
    TUMBLE(TABLE enriched_parsed, DESCRIPTOR(event_time), INTERVAL '1' MINUTE)
)
GROUP BY tenant_id, user_id, window_start, window_end;
*/
