# Data Agent 控制台（前端）

TailAdmin 风格的 React + Vite + Tailwind 前端，对接 `sql-engine`。

## 功能

- **概览**：各对象规模卡片（实时取自 `/objects/search` count）。
- **统一筛选器**：多条件 / 多条线（AND·OR）+ 跨对象**链式多跳**关联 + **边条件**
  （`create_time` / `properties.<key>`），实时**预估人数** + **SQL 预览**。
- **自然语言圈人**：输入中文 → `/agent/segment/draft` → 回填筛选器 + 摘要 + 预估。
- **存为群组**：基于当前筛选规则一键保存为 Segment（`/agent/segment/confirm`，自动校验 + 预估）。
- **对象页**：用户 / 客户 / 商品 / 门店 / **订单**（接 `/objects/search`）、用户标签（`/tags`）、
  用户群组（`/segments`）。
- **可视化 ETL**：多数据源（CSV/粘贴、inline 可运行；MySQL/Kafka/API 路线图）→ 字段映射
  （自动匹配）→ 预览（干跑）→ 导入多对象（`/etl/preview`、`/etl/import`）→ 一键去筛选；
  支持导入时建立关系（如订单→含→商品）。

## 开发

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173 （/api 代理到 sql-engine:8002）

# 指定后端地址
SQL_ENGINE_URL=http://localhost:8002 npm run dev
```

前置：`sql-engine` 已启动（`docker compose up -d sql-engine` + 迁移）。

## 构建 / 部署

```bash
npm run build          # 产物在 dist/（base=/console/）
```

生产由网关 nginx 托管 `dist/` 于 **`/console/`**，并把 `/api/*` 反代到 `sql-engine`（去掉 `/api` 前缀）。
`docker-compose` 的 nginx 服务已挂载 `./frontend/dist → /usr/share/nginx/console`，
所以改完前端 `npm run build` 后访问 **http://localhost:8080/console/** 即生效（无需重启容器，dist 是只读挂载）。

> 首次 / 全新克隆：先 `cd frontend && npm install && npm run build` 生成 `dist/`，再 `docker compose up -d nginx`。

## 技术栈

React 18 · Vite 5 · TypeScript · TailwindCSS 3 · react-router 6 · axios · lucide-react

## 目录

```
src/
  api/        client.ts(接口) · types.ts(DSL 类型)
  lib/        objects.ts(对象配置 / 操作符)
  context/    TenantContext.tsx(租户切换)
  components/
    layout/   Sidebar · Header · Layout
    filter/   UnifiedFilter · RelationEditor(递归) · ConditionEditor
    ui.tsx    Card · Button · DataTable · Badge …
  pages/      Dashboard · FilterPage · EtlPage · ObjectListPage · Tags · Segments · Orders
```
