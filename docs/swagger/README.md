# API Swagger 文档

## 在线文档（服务启动后访问）

**网关入口**：http://localhost:8080/

| 服务 | 网关 Swagger | 直连 Swagger | OpenAPI JSON |
|------|-------------|-------------|--------------|
| ID-Mapping | http://localhost:8080/ID-Mapping/docs | http://localhost:8001/docs | http://localhost:8001/openapi.json |
| SQL Engine | http://localhost:8080/SQL%20Engine/docs | http://localhost:8002/docs | http://localhost:8002/openapi.json |

## 导出静态文档

```bash
docker compose up -d
bash scripts/generate_swagger.sh
```

## SQL Engine API 分组

| Tag | 接口 |
|-----|------|
| 系统 | `GET /health` |
| 模板查询 | `GET/POST /query/{template}` |
| 自然语言 | `POST /nl-query` |
| 用户分组 | `POST/GET /groups/*` |
| 用户 | `GET /users/{tenant_id}/{one_id}` |
