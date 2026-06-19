-- 自定义看板：一个看板 = 标题 + 一组图表数据源（sources）。内置看板（用户/客户/ROI）是前端页面，不入库。
USE dataagent;

CREATE TABLE IF NOT EXISTS analyst_dashboards (
    id          VARCHAR(64)  NOT NULL,
    tenant_id   BIGINT       NOT NULL,
    title       VARCHAR(255) NOT NULL,
    sources     JSON         NOT NULL COMMENT '图表数据源 key 列表',
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
