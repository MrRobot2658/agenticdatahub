"""用户画像实时 E2E 测试 — 公共配置与 fixture"""

import os
import time

import pymysql
import pytest
import redis
import requests

MYSQL_CONFIG = {
    "host": os.getenv("TEST_MYSQL_HOST", "localhost"),
    "port": int(os.getenv("TEST_MYSQL_PORT", "3308")),
    "user": os.getenv("TEST_MYSQL_USER", "dataagent"),
    "password": os.getenv("TEST_MYSQL_PASSWORD", "dataagent123"),
    "database": os.getenv("TEST_MYSQL_DATABASE", "dataagent"),
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
}

REDIS_HOST = os.getenv("TEST_REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("TEST_REDIS_PORT", "6381"))
API_BASE = os.getenv("TEST_API_BASE", "http://localhost:8001")
KAFKA_BOOTSTRAP = os.getenv("TEST_KAFKA_BOOTSTRAP", "localhost:9094")


def wait_for_service(url: str, timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            resp = requests.get(url, timeout=3)
            if resp.status_code == 200:
                return True
        except requests.RequestException:
            pass
        time.sleep(2)
    return False


@pytest.fixture(scope="session")
def services_ready():
    """确保 Docker 服务已启动"""
    if not wait_for_service(f"{API_BASE}/health"):
        pytest.skip("id-mapping 服务未就绪，请先运行: docker compose up -d --build")
    yield


@pytest.fixture
def mysql_conn():
    conn = pymysql.connect(**MYSQL_CONFIG)
    yield conn
    conn.close()


# ── 多对象 demo 用户的确定性标签（与 sql/migrate_objects.sql 的 UPSERT 同源）──────
# id-mapping 管道或其他用例重算 doris_user_wide 时，会把这几个 demo 用户的 tags
# 冲掉成 []，而跨对象筛选断言（test_multi_object / test_mcp_server）依赖它们带 vip。
# 自愈 fixture：在相关用例前重灌，确保连续多次跑、任意顺序都稳定绿。
_DEMO_USER_WIDE_UPSERT = """
INSERT INTO doris_user_wide (tenant_id, one_id, phone, channel_count, tags, properties) VALUES
    (1001, 100002, '13800138002', 1, JSON_ARRAY('vip', 'high_value'), JSON_OBJECT('total_amount', 38000)),
    (1001, 100003, '13800138003', 1, JSON_ARRAY('normal'),            JSON_OBJECT('total_amount', 1200)),
    (1001, 100004, '13800138004', 1, JSON_ARRAY('vip'),               JSON_OBJECT('total_amount', 52000))
ON DUPLICATE KEY UPDATE
    tags=VALUES(tags), phone=VALUES(phone), properties=VALUES(properties)
"""


@pytest.fixture
def restore_demo_objects():
    """重灌多对象 demo 用户的确定性标签（自愈）。MySQL 未就绪时静默 no-op，
    不改变各测试自身的服务可用性判断（服务没起时测试照常跳过/失败）。"""
    try:
        conn = pymysql.connect(**MYSQL_CONFIG)
    except Exception:
        yield
        return
    try:
        with conn.cursor() as cur:
            cur.execute(_DEMO_USER_WIDE_UPSERT)
        conn.commit()
    finally:
        conn.close()
    yield


@pytest.fixture
def redis_client():
    return redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)


@pytest.fixture
def api_base():
    return API_BASE


@pytest.fixture
def kafka_bootstrap():
    return KAFKA_BOOTSTRAP
