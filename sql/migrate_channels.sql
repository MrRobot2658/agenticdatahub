-- migrate_channels.sql — 扩展用户身份渠道：官网埋点 / 公众号 / 视频号 / 小红书 / 抖音
-- ------------------------------------------------------------------------
-- 在原有 wechat_openid/wechat_unionid/wework_extid/form_id/phone/email/device
-- 基础上，给 Doris 宽表新增 5 个全域渠道身份列（OneID 仍由 id-mapping 合并）。
-- 原则：只做加法，幂等可重复执行（_add_col 先检信息架构再 ALTER）。
USE dataagent;

-- ── 幂等 DDL 辅助：仅当列不存在时才 ADD COLUMN ──────────────────────────
DROP PROCEDURE IF EXISTS _add_col;
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
DELIMITER ;

-- ── Doris 宽表新增全域渠道身份列 ────────────────────────────────────────
CALL _add_col('doris_user_wide', 'web_visitor_id',      "web_visitor_id VARCHAR(256) COMMENT '官网埋点访客ID（cookie/匿名ID）' AFTER device");
CALL _add_col('doris_user_wide', 'wechat_mp_openid',    "wechat_mp_openid VARCHAR(256) COMMENT '微信公众号关注者 openid' AFTER web_visitor_id");
CALL _add_col('doris_user_wide', 'wechat_channels_id',  "wechat_channels_id VARCHAR(256) COMMENT '微信视频号用户ID' AFTER wechat_mp_openid");
CALL _add_col('doris_user_wide', 'xiaohongshu_id',      "xiaohongshu_id VARCHAR(256) COMMENT '小红书用户ID' AFTER wechat_channels_id");
CALL _add_col('doris_user_wide', 'douyin_id',           "douyin_id VARCHAR(256) COMMENT '抖音用户ID（open_id/unionid）' AFTER xiaohongshu_id");

DROP PROCEDURE IF EXISTS _add_col;
