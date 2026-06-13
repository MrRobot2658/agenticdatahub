-- =============================================================================
-- Job-0: Flink SQL Connector & 表 DDL
-- 在 StreamPark / SQL Client 中先执行本文件，注册 Kafka / Doris 连接器
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 原始用户事件（Kafka Source）
-- -----------------------------------------------------------------------------
CREATE TABLE kafka_user_events (
    event_id      STRING,
    tenant_id     BIGINT,
    channel_type  STRING,
    channel_id    STRING,
    event_type    STRING,
    event_time    TIMESTAMP(3),
    link_keys     MAP<STRING, STRING>,
    properties    STRING,                    -- JSON 字符串
    proc_time     AS PROCTIME()
) WITH (
    'connector'                    = 'kafka',
    'topic'                        = 'tenant-1001-events',
    'properties.bootstrap.servers' = 'kafka:9092',
    'properties.group.id'          = 'flink-profile-1001',
    'scan.startup.mode'            = 'earliest-offset',
    'format'                       = 'json',
    'json.fail-on-missing-field'   = 'false',
    'json.ignore-parse-errors'     = 'true'
);

-- -----------------------------------------------------------------------------
-- 2. 富化事件（Kafka Sink，Job-1 DataStream 写入，Job-2/3 读取）
-- -----------------------------------------------------------------------------
CREATE TABLE kafka_enriched_events (
    event_id      STRING,
    tenant_id     BIGINT,
    one_id        BIGINT,
    channel_type  STRING,
    channel_id    STRING,
    event_type    STRING,
    event_time    TIMESTAMP(3),
    action        STRING,                    -- create / link / merge / hit_cache
    properties    STRING,
    processed_at  TIMESTAMP(3)
) WITH (
    'connector'                    = 'kafka',
    'topic'                        = 'enriched-1001-events',
    'properties.bootstrap.servers' = 'kafka:9092',
    'format'                       = 'json'
);

-- 消费富化事件（Job-2 / Job-3 Source）
CREATE TABLE kafka_enriched_events_source (
    event_id      STRING,
    tenant_id     BIGINT,
    one_id        BIGINT,
    channel_type  STRING,
    channel_id    STRING,
    event_type    STRING,
    event_time    TIMESTAMP(3),
    action        STRING,
    properties    STRING,
    processed_at  TIMESTAMP(3),
    WATERMARK FOR event_time AS event_time - INTERVAL '5' SECOND
) WITH (
    'connector'                    = 'kafka',
    'topic'                        = 'enriched-1001-events',
    'properties.bootstrap.servers' = 'kafka:9092',
    'properties.group.id'          = 'flink-profile-agg-1001',
    'scan.startup.mode'            = 'earliest-offset',
    'format'                       = 'json',
    'json.fail-on-missing-field'   = 'false'
);

-- -----------------------------------------------------------------------------
-- 3. Doris id_mapping（Sink，Job-1 DataStream 写入）
-- -----------------------------------------------------------------------------
CREATE TABLE doris_id_mapping (
    tenant_id     BIGINT,
    channel_type  STRING,
    channel_id    STRING,
    one_id        BIGINT,
    confidence    DOUBLE,
    source        STRING,
    create_time   TIMESTAMP(3),
    update_time   TIMESTAMP(3)
) WITH (
    'connector'      = 'doris',
    'fenodes'        = 'fe1:8030',
    'table.identifier' = 'tenant_1001.id_mapping',
    'username'       = 'root',
    'password'       = '',
    'sink.label-prefix' = 'id_mapping',
    'sink.enable-delete' = 'false'
);

-- -----------------------------------------------------------------------------
-- 4. Doris user_profile（Sink，Job-2 写入）
-- -----------------------------------------------------------------------------
CREATE TABLE doris_user_profile (
    user_id       BIGINT,
    channel_type  STRING,
    channel_id    STRING,
    tags          STRING,                    -- 逗号分隔标签，入库转 BITMAP
    properties    STRING,
    update_time   TIMESTAMP(3)
) WITH (
    'connector'      = 'doris',
    'fenodes'        = 'fe1:8030',
    'table.identifier' = 'tenant_1001.user_profile',
    'username'       = 'root',
    'password'       = '',
    'sink.label-prefix' = 'user_profile'
);

-- -----------------------------------------------------------------------------
-- 5. Doris user_wide（Sink，Job-3 写入）
-- -----------------------------------------------------------------------------
CREATE TABLE doris_user_wide (
    one_id            BIGINT,
    wechat_openid     STRING,
    wechat_unionid    STRING,
    wework_extid      STRING,
    form_id           STRING,
    phone             STRING,
    email             STRING,
    device            STRING,
    channel_count     INT,
    tags              STRING,
    properties        STRING,
    last_event_time   TIMESTAMP(3),
    update_time       TIMESTAMP(3)
) WITH (
    'connector'      = 'doris',
    'fenodes'        = 'fe1:8030',
    'table.identifier' = 'tenant_1001.user_wide',
    'username'       = 'root',
    'password'       = '',
    'sink.label-prefix' = 'user_wide'
);

-- -----------------------------------------------------------------------------
-- 6. Doris id_mapping 维表（Job-3 宽表打宽时 Lookup）
-- -----------------------------------------------------------------------------
CREATE TABLE doris_id_mapping_lookup (
    tenant_id     BIGINT,
    channel_type  STRING,
    channel_id    STRING,
    one_id        BIGINT,
    source        STRING,
    update_time   TIMESTAMP(3)
) WITH (
    'connector'      = 'doris',
    'fenodes'        = 'fe1:8030',
    'table.identifier' = 'tenant_1001.id_mapping',
    'username'       = 'root',
    'password'       = ''
);
