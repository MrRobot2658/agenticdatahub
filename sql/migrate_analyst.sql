-- Analyst：保存的图表。图表 = {标题, 图表类型, 数据源 key}；数据源是后端白名单聚合。
USE dataagent;

CREATE TABLE IF NOT EXISTS analyst_charts (
    id          VARCHAR(64)  NOT NULL,
    tenant_id   BIGINT       NOT NULL,
    title       VARCHAR(255) NOT NULL,
    type        VARCHAR(16)  NOT NULL DEFAULT 'bar' COMMENT 'bar/line/pie/area',
    source      VARCHAR(64)  NOT NULL COMMENT '后端数据源 key',
    sort_order  INT          NOT NULL DEFAULT 0,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_tenant (tenant_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 默认图表（租户 1001 / 1002 各几个）
INSERT IGNORE INTO analyst_charts (id, tenant_id, title, type, source, sort_order) VALUES
    ('ch_1001_obj',  1001, '各对象数据量',   'bar', 'objects_count',   0),
    ('ch_1001_ord',  1001, '订单状态分布',   'pie', 'order_status',    1),
    ('ch_1001_lead', 1001, '线索阶段分布',   'bar', 'lead_stage',      2),
    ('ch_1001_acc',  1001, '客户行业分布',   'pie', 'account_industry',3),
    ('ch_1002_obj',  1002, '各对象数据量',   'bar', 'objects_count',   0),
    ('ch_1002_ord',  1002, '订单状态分布',   'pie', 'order_status',    1);
