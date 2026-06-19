-- 智能助手聊天记录（按用户存储）。每条消息一行，user_id 为登录用户。
USE dataagent;

CREATE TABLE IF NOT EXISTS assistant_messages (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    tenant_id   BIGINT       NOT NULL,
    user_id     BIGINT       NOT NULL,
    role        VARCHAR(16)  NOT NULL COMMENT 'user/assistant',
    content     MEDIUMTEXT   NOT NULL,
    agent       VARCHAR(32)  NULL COMMENT '处理该回复的智能体 key',
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_user (tenant_id, user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 多会话支持（new chat / 会话保存）：给消息加 conversation_id（幂等）。
DROP PROCEDURE IF EXISTS _add_col;
DROP PROCEDURE IF EXISTS _add_idx;
DELIMITER $$
CREATE PROCEDURE _add_col(IN p_tbl VARCHAR(64), IN p_col VARCHAR(64), IN p_ddl VARCHAR(2048))
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl AND COLUMN_NAME = p_col
    ) THEN
        SET @s = CONCAT('ALTER TABLE `', p_tbl, '` ADD COLUMN ', p_ddl);
        PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
    END IF;
END$$
CREATE PROCEDURE _add_idx(IN p_tbl VARCHAR(64), IN p_idx VARCHAR(64), IN p_cols VARCHAR(512))
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_tbl AND INDEX_NAME = p_idx
    ) THEN
        SET @s = CONCAT('ALTER TABLE `', p_tbl, '` ADD INDEX `', p_idx, '` (', p_cols, ')');
        PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
    END IF;
END$$
DELIMITER ;
CALL _add_col('assistant_messages', 'conversation_id', "conversation_id VARCHAR(64) NULL COMMENT '会话ID，支持多会话' AFTER user_id");
CALL _add_idx('assistant_messages', 'idx_conv', 'tenant_id, user_id, conversation_id, id');

-- conversation_id 必须是字符串（前端用 c_xxxx 形式的会话ID）。若历史库里它是数值类型，纠正之（幂等）。
DROP PROCEDURE IF EXISTS _fix_conv_type;
DELIMITER $$
CREATE PROCEDURE _fix_conv_type()
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assistant_messages'
          AND COLUMN_NAME = 'conversation_id' AND DATA_TYPE <> 'varchar'
    ) THEN
        ALTER TABLE assistant_messages
            MODIFY COLUMN conversation_id VARCHAR(64) NULL COMMENT '会话ID，支持多会话';
    END IF;
END$$
DELIMITER ;
CALL _fix_conv_type();

DROP PROCEDURE IF EXISTS _add_col;
DROP PROCEDURE IF EXISTS _add_idx;
DROP PROCEDURE IF EXISTS _fix_conv_type;
