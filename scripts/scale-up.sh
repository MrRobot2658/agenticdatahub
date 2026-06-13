#!/bin/bash
# 按数据量规模启动 Docker 集群（模拟生产服务器拓扑）
# 用法: bash scripts/scale-up.sh [dev|medium|large|xlarge]
set -euo pipefail

cd "$(dirname "$0")/.."

SCALE="${1:-dev}"

case "$SCALE" in
  dev)
    KAFKA_PARTITIONS_PREMIUM=4;  KAFKA_PARTITIONS_STANDARD=2;  KAFKA_PARTITIONS_SHARED=4
    KAFKA_REPLICATION=1; REDIS_MAXMEMORY=256mb; ID_MAPPING_REPLICAS=1; SQL_ENGINE_REPLICAS=1
    DORIS_BE_SHARDS=1; MYSQL_MEMORY_LIMIT=1g; PROFILE="" ;;
  medium)
    KAFKA_PARTITIONS_PREMIUM=8;  KAFKA_PARTITIONS_STANDARD=4;  KAFKA_PARTITIONS_SHARED=8
    KAFKA_REPLICATION=1; REDIS_MAXMEMORY=1gb; ID_MAPPING_REPLICAS=2; SQL_ENGINE_REPLICAS=1
    DORIS_BE_SHARDS=4; MYSQL_MEMORY_LIMIT=2g; PROFILE="--profile scale-medium" ;;
  large)
    KAFKA_PARTITIONS_PREMIUM=16; KAFKA_PARTITIONS_STANDARD=8;  KAFKA_PARTITIONS_SHARED=16
    KAFKA_REPLICATION=2; REDIS_MAXMEMORY=2gb; ID_MAPPING_REPLICAS=4; SQL_ENGINE_REPLICAS=2
    DORIS_BE_SHARDS=8; MYSQL_MEMORY_LIMIT=6g; PROFILE="--profile scale-large" ;;
  xlarge)
    KAFKA_PARTITIONS_PREMIUM=32; KAFKA_PARTITIONS_STANDARD=16; KAFKA_PARTITIONS_SHARED=32
    KAFKA_REPLICATION=2; REDIS_MAXMEMORY=4gb; ID_MAPPING_REPLICAS=8; SQL_ENGINE_REPLICAS=3
    DORIS_BE_SHARDS=12; MYSQL_MEMORY_LIMIT=12g; PROFILE="--profile scale-xlarge" ;;
  *)
    echo "用法: bash scripts/scale-up.sh [dev|medium|large|xlarge]"
    exit 1 ;;
esac

export SCALE KAFKA_PARTITIONS_PREMIUM KAFKA_PARTITIONS_STANDARD KAFKA_PARTITIONS_SHARED
export KAFKA_REPLICATION REDIS_MAXMEMORY REDIS_MEMORY="$REDIS_MAXMEMORY"
export ID_MAPPING_REPLICAS SQL_ENGINE_REPLICAS DORIS_BE_SHARDS MYSQL_MEMORY_LIMIT

cp "docker/mysql/conf.d/tier-${SCALE}.cnf" docker/mysql/conf.d/scale.cnf

echo "=========================================="
echo " 数据规模: $SCALE"
echo " Kafka 分区: premium=$KAFKA_PARTITIONS_PREMIUM / standard=$KAFKA_PARTITIONS_STANDARD"
echo " id-mapping × $ID_MAPPING_REPLICAS | sql-engine × $SQL_ENGINE_REPLICAS"
echo " Doris BE 模拟分片: $DORIS_BE_SHARDS"
echo "=========================================="

docker compose -f docker-compose.yml -f docker/compose/scale.yml $PROFILE up -d --build \
  --scale id-mapping="${ID_MAPPING_REPLICAS}"

echo ""
echo "服务地址:"
echo "  ID-Mapping:  http://localhost:8001"
echo "  SQL Engine:  http://localhost:8002  (OLAP 查询层)"
echo "  Kafka UI:    http://localhost:8083"
echo ""
docker compose -f docker-compose.yml -f docker/compose/scale.yml ps
