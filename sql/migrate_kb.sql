-- 知识库：云盘式多模态文件存储 + 可关联到对象。
-- 文件字节存盘（KB_STORAGE_DIR 卷），元数据落库；kb_links 把文件关联到对象（类型/记录）。
USE agenticdatahub;

CREATE TABLE IF NOT EXISTS kb_files (
    id            VARCHAR(64)  NOT NULL,
    tenant_id     BIGINT       NOT NULL,
    name          VARCHAR(255) NOT NULL COMMENT '原始文件名',
    folder        VARCHAR(512) NOT NULL DEFAULT '/' COMMENT '虚拟目录路径，如 /合同/2026',
    mime_type     VARCHAR(128) NULL,
    kind          VARCHAR(32)  NOT NULL DEFAULT 'other' COMMENT 'document/image/audio/video/archive/other',
    size_bytes    BIGINT       NOT NULL DEFAULT 0,
    storage_path  VARCHAR(512) NULL COMMENT '磁盘相对路径',
    description   VARCHAR(1024) NULL,
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_tenant_folder (tenant_id, folder),
    INDEX idx_tenant_kind (tenant_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 文件 ↔ 对象 关联（object_id 可空：仅关联到对象类型）
CREATE TABLE IF NOT EXISTS kb_links (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    tenant_id   BIGINT       NOT NULL,
    file_id     VARCHAR(64)  NOT NULL,
    object_type VARCHAR(32)  NOT NULL COMMENT 'user/lead/account/product/store/order',
    object_id   VARCHAR(64)  NULL,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_file (file_id),
    INDEX idx_obj (tenant_id, object_type, object_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
