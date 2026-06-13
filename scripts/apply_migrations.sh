#!/bin/bash
# 应用 sql/migrate_*.sql 增量迁移到 datalake-mysql
# 关键：用 --default-character-set=utf8mb4 避免管道导入中文乱码（双重编码）
set -euo pipefail

CONTAINER="${MYSQL_CONTAINER:-datalake-mysql}"
DB="${MYSQL_DATABASE:-datalake}"
USER="${MYSQL_USER:-datalake}"
PASS="${MYSQL_PASSWORD:-datalake123}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/sql"

echo "== 应用迁移到 $CONTAINER/$DB =="
for f in "$DIR"/migrate_*.sql; do
  [ -e "$f" ] || continue
  echo "-> $(basename "$f")"
  docker exec -i "$CONTAINER" mysql --default-character-set=utf8mb4 \
    -u"$USER" -p"$PASS" "$DB" < "$f"
done
echo "== 迁移完成 =="
