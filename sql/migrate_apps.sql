-- 应用市场：每租户已连接的应用（CRM / 广告 / 消息 / 分析等）。
-- 应用目录是前端静态注册表（lib/apps.ts）；这里只存「某租户连接了哪些、状态、配置」。
USE agenticdatahub;

CREATE TABLE IF NOT EXISTS installed_apps (
    tenant_id   BIGINT       NOT NULL,
    app_key     VARCHAR(64)  NOT NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active/inactive',
    config      JSON         NULL,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, app_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
