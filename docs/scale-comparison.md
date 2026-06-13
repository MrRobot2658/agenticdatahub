# Docker 规模扩展对照表

模拟生产服务器拓扑，通过 `bash scripts/scale-up.sh <tier>` 一键切换。

| 配置项 | dev (<1万) | medium (1000万) | large (1亿) | xlarge (2亿) |
|--------|-----------|----------------|------------|-------------|
| **Kafka Broker** | 1 | 2 | 3 | 5 |
| **Topic 分区(premium)** | 4 | 8 | 16 | 32 |
| **Topic 副本** | 1 | 1 | 2 | 2 |
| **Redis 节点** | 1 | 2 | 3 | 6 |
| **Redis 内存/节点** | 256MB | 1GB | 2GB | 4GB |
| **MySQL buffer pool** | 256M | 1G | 4G | 8G |
| **id-mapping 副本** | 1 | 2 | 4 | 8 |
| **sql-engine 副本** | 1 | 1 | 2 | 3 |
| **Doris BE 模拟分片** | 1 | 4 | 8 | 12 |

## 启动命令

```bash
bash scripts/scale-up.sh dev       # 默认开发
bash scripts/scale-up.sh medium    # +kafka-2, redis-2
bash scripts/scale-up.sh large     # +kafka-3, redis-3
bash scripts/scale-up.sh xlarge    # +kafka-4/5, 全量节点
```

## 服务端口

| 服务 | 端口 |
|------|------|
| ID-Mapping | 8001 |
| **SQL Engine** | **8002** |
| Kafka broker-1 | 9094 |
| Kafka broker-2 | 9095 (medium+) |
| Redis-1 | 6381 |
| Redis-2 | 6382 (medium+) |
| MySQL | 3308 |

## SQL Engine 切换真实 Doris

```bash
OLAP_BACKEND=doris \
OLAP_HOST=doris-fe \
OLAP_PORT=9030 \
OLAP_DATABASE=tenant_1001 \
docker compose up -d sql-engine
```
