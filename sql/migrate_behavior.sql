-- 主动式埋点 Copilot：浏览器行为事件 + 已发出的主动建议（落库做上下文/分析/调优）。
-- 只存元信息（页面路径、动作类型、计数、错误码），不存敏感字段。所有表带 tenant_id 隔离。
USE dataagent;

CREATE TABLE IF NOT EXISTS user_behavior_events (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    tenant_id   BIGINT       NOT NULL,
    user_id     BIGINT       NOT NULL,
    session_id  VARCHAR(64)  NOT NULL COMMENT '浏览器会话 id（前端生成）',
    event_type  VARCHAR(32)  NOT NULL COMMENT 'page_view/click/search/empty_state/error/idle/repeat',
    page_path   VARCHAR(255) NULL,
    page_name   VARCHAR(128) NULL,
    payload     JSON         NULL COMMENT '事件元信息（计数/错误码/停留时长等）',
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_user (tenant_id, user_id, id),
    INDEX idx_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS proactive_suggestions (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    tenant_id      BIGINT       NOT NULL,
    user_id        BIGINT       NOT NULL,
    session_id     VARCHAR(64)  NOT NULL,
    trigger_signal VARCHAR(64)  NULL COMMENT '命中的启发式信号',
    title          VARCHAR(255) NULL,
    message        TEXT         NULL,
    action         JSON         NULL COMMENT '可选 action：{type, path/payload}',
    confidence     DOUBLE       NULL,
    shown_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
    dismissed      TINYINT      DEFAULT 0,
    accepted       TINYINT      DEFAULT 0,
    PRIMARY KEY (id),
    INDEX idx_user (tenant_id, user_id, id),
    INDEX idx_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
