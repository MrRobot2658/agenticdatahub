-- =============================================================================
-- Job-3: Doris 用户宽表实时打宽（Flink SQL）
-- Source: enriched-1001-events + Doris id_mapping
-- Sink:   Doris tenant_1001.user_wide
--
-- 职责:
--   - 多渠道身份字段列展开（微信 / 企微 / 表单 / 手机号）
--   - 关联最新画像快照
--   - UNIQUE KEY Upsert
-- =============================================================================

-- 前置: 先执行 job-01-ddl-connectors.sql

-- Step 1: 每次富化事件触发，按 one_id 聚合当前已知身份映射
CREATE TEMPORARY VIEW identity_pivot AS
SELECT
    tenant_id,
    one_id,
    MAX(CASE WHEN channel_type = 'wechat_openid'  THEN channel_id END) AS wechat_openid,
    MAX(CASE WHEN channel_type = 'wechat_unionid' THEN channel_id END) AS wechat_unionid,
    MAX(CASE WHEN channel_type = 'wework_extid'   THEN channel_id END) AS wework_extid,
    MAX(CASE WHEN channel_type = 'form_id'        THEN channel_id END) AS form_id,
    MAX(CASE WHEN channel_type = 'phone'          THEN channel_id END) AS phone,
    MAX(CASE WHEN channel_type = 'email'          THEN channel_id END) AS email,
    MAX(CASE WHEN channel_type = 'device'         THEN channel_id END) AS device,
    COUNT(DISTINCT channel_id)                                         AS channel_count,
    MAX(event_time)                                                    AS last_event_time
FROM (
    -- 当前事件携带的 channel
    SELECT tenant_id, one_id, channel_type, channel_id, event_time
    FROM kafka_enriched_events_source
    WHERE tenant_id = 1001

    UNION ALL

    -- 历史映射（Lookup 全量 id_mapping，生产建议改 CDC 或状态表）
    SELECT
        1001          AS tenant_id,
        one_id,
        channel_type,
        channel_id,
        update_time   AS event_time
    FROM doris_id_mapping_lookup
    WHERE tenant_id = 1001
) t
GROUP BY tenant_id, one_id;

-- Step 2: 关联画像，写入宽表
INSERT INTO doris_user_wide
SELECT
    i.one_id,
    i.wechat_openid,
    i.wechat_unionid,
    i.wework_extid,
    i.form_id,
    i.phone,
    i.email,
    i.device,
    i.channel_count,
    p.tags,
    p.properties,
    i.last_event_time,
    CURRENT_TIMESTAMP AS update_time
FROM identity_pivot i
LEFT JOIN doris_user_profile FOR SYSTEM_TIME AS OF PROCTIME() AS p
    ON i.one_id = p.user_id;

-- =============================================================================
-- 生产优化建议
-- =============================================================================
-- 1. id_mapping 改用 Doris CDC Source 替代 Lookup 全表扫描
-- 2. 宽表打宽由 Job-1 DataStream 在 merge 后直接触发（延迟更低）
-- 3. channel_count 建议从 id_mapping 状态表精确计算，避免 UNION 重复
