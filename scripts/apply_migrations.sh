#!/bin/bash
# 应用 sql/migrate_*.sql 增量迁移到 dataagent-mysql
# 关键：用 --default-character-set=utf8mb4 避免管道导入中文乱码（双重编码）
set -euo pipefail

CONTAINER="${MYSQL_CONTAINER:-dataagent-mysql}"
DB="${MYSQL_DATABASE:-dataagent}"
USER="${MYSQL_USER:-dataagent}"
PASS="${MYSQL_PASSWORD:-dataagent123}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/sql"

# 迁移之间存在依赖：migrate_modules.sql 会 ALTER tag_definitions / user_groups，
# 这两张表分别由 migrate_tags.sql / migrate_groups.sql 创建。字母序（modules 在 tags
# 之前）在全新库上会报 "Table 'tag_definitions' doesn't exist"，因此必须按依赖顺序。
# 先按下列显式顺序应用已知文件，其余新增的 migrate_*.sql 再按字母序补齐。
ORDER=(doris groups tags modules objects segments)

apply() {
  local f="$1"
  echo "-> $(basename "$f")"
  docker exec -i "$CONTAINER" mysql --default-character-set=utf8mb4 \
    -u"$USER" -p"$PASS" "$DB" < "$f"
}

echo "== 应用迁移到 $CONTAINER/$DB =="
applied=()
for name in "${ORDER[@]}"; do
  f="$DIR/migrate_$name.sql"
  [ -e "$f" ] || continue
  apply "$f"
  applied+=("$f")
done
# 兜底：应用任何不在显式顺序里的新迁移文件（按字母序）
for f in "$DIR"/migrate_*.sql; do
  [ -e "$f" ] || continue
  [[ " ${applied[*]} " == *" $f "* ]] && continue
  apply "$f"
done
echo "== 迁移完成 =="
