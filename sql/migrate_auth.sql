-- 用户登录：给 users 加 password_hash，并把团队成员作为登录账号挂在 workspace(租户)下
-- 部门=teams（挂在 tenant 下）、账号=users（带密码）、归属=team_members
-- 演示密码统一为 demo123；hash = sha256("dataagent:" + password)（dev 演示级）
-- 依赖 migrate_modules.sql 的 IAM 表；幂等（显式 id + INSERT IGNORE + 列存在性判断）
USE dataagent;

-- ── 给 users 加 password_hash 列（幂等）──────────────────────────────────────
SET @ddl := IF(
  NOT EXISTS(SELECT 1 FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'password_hash'),
  'ALTER TABLE users ADD COLUMN password_hash VARCHAR(128) NULL COMMENT ''sha256(pepper:password)''',
  'SELECT 1');
PREPARE _s FROM @ddl; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ── 部门（teams）挂在 workspace 1001 下 ─────────────────────────────────────
INSERT IGNORE INTO teams (id, tenant_id, name, description) VALUES
    (9001, 1001, '技术部', '研发与平台工程'),
    (9002, 1001, '销售部', '客户签约与营收'),
    (9003, 1001, '市场部', '品牌、获客与活动运营');

-- ── 团队成员（登录账号），统一演示密码 demo123 ──────────────────────────────
INSERT IGNORE INTO users (id, tenant_id, email, name, status, password_hash) VALUES
    (90001, 1001, 'admin@acme.com',      '管理员', 'active', '7107d8f63c794ad87aba818e28526793f4725ce32e0c6b6c926a48924627fb03'),
    (90002, 1001, 'zhang.tech@acme.com', '张伟',   'active', '7107d8f63c794ad87aba818e28526793f4725ce32e0c6b6c926a48924627fb03'),
    (90003, 1001, 'li.tech@acme.com',    '李娜',   'active', '7107d8f63c794ad87aba818e28526793f4725ce32e0c6b6c926a48924627fb03'),
    (90004, 1001, 'zhao.sales@acme.com', '赵敏',   'active', '7107d8f63c794ad87aba818e28526793f4725ce32e0c6b6c926a48924627fb03'),
    (90005, 1001, 'qian.sales@acme.com', '钱锋',   'active', '7107d8f63c794ad87aba818e28526793f4725ce32e0c6b6c926a48924627fb03'),
    (90006, 1001, 'sun.mkt@acme.com',    '孙琳',   'active', '7107d8f63c794ad87aba818e28526793f4725ce32e0c6b6c926a48924627fb03');

-- 给已存在但未设密码的这些账号补上 demo 密码（幂等可重入）
UPDATE users SET password_hash = '7107d8f63c794ad87aba818e28526793f4725ce32e0c6b6c926a48924627fb03'
WHERE id BETWEEN 90001 AND 90006 AND tenant_id = 1001 AND (password_hash IS NULL OR password_hash = '');

-- ── 成员归属部门 ─────────────────────────────────────────────────────────────
INSERT IGNORE INTO team_members (team_id, user_id) VALUES
    (9001, 90001), (9001, 90002), (9001, 90003),
    (9002, 90004), (9002, 90005),
    (9003, 90006);
