#!/bin/bash
# 导出所有 API 的 OpenAPI (Swagger) 文档
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p docs/swagger

echo "导出 ID-Mapping OpenAPI..."
curl -sf http://localhost:8001/openapi.json -o docs/swagger/id-mapping.openapi.json

echo "导出 SQL Engine OpenAPI..."
curl -sf http://localhost:8002/openapi.json -o docs/swagger/sql-engine.openapi.json

echo "完成:"
echo "  docs/swagger/id-mapping.openapi.json"
echo "  docs/swagger/sql-engine.openapi.json"
echo ""
echo "在线 Swagger UI:"
echo "  ID-Mapping:  http://localhost:8001/docs"
echo "  SQL Engine:  http://localhost:8002/docs"
