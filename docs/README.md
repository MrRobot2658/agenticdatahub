# 模块产品文档（分模块开发）

按 Twilio Segment 的信息架构，把 CDP 拆成 **1 个平台底座 + 9 个业务模块**，并在其上扩展 **3 个 AgenticDataHub 一级菜单（知识库 / 应用 / 分析）**。每个模块一份文档，含 **详细设计（产品）/ 技术设计 / TODOs**，可被独立认领、并行开发。文档已**直接放在 `docs/` 下**（不再分 `modules/` 子目录）。

## 模块清单

| # | 模块 | 对标 Segment | 当前状态 | 文档 |
|---|------|------------|---------|------|
| 00 | 平台底座 Platform | App Shell / IAM 壳 | 外壳真实、鉴权 Mock | [00-platform.md](./00-platform.md) |
| 01 | 连接 Connections | Connections | ETL 真实，其余 Mock | [01-connections.md](./01-connections.md) |
| 02 | 统一 Unify | Unify | 大部分真实 | [02-unify.md](./02-unify.md) |
| 03 | 对象管理 Objects | Linked Objects | 真实 | [03-objects.md](./03-objects.md) |
| 04 | 客户管理 Accounts | Account-level Profiles | 真实 | [04-accounts.md](./04-accounts.md) |
| 05 | 触达 Engage | Engage | 受众/圈人真实，其余 Mock | [05-engage.md](./05-engage.md) |
| 06 | 协议 Protocols | Protocols | 全 Mock | [06-protocols.md](./06-protocols.md) |
| 07 | 隐私 Privacy | Privacy | 全 Mock | [07-privacy.md](./07-privacy.md) |
| 08 | 监控 Monitor | Monitor | 全 Mock | [08-monitor.md](./08-monitor.md) |
| 09 | 设置 Settings | Settings / IAM | 全 Mock | [09-settings.md](./09-settings.md) |
| 10 | 知识库 Knowledge | —（AgenticDataHub 扩展） | 真实 | [10-knowledge.md](./10-knowledge.md) |
| 11 | 应用 Apps | —（应用市场） | 连接状态真实 | [11-apps.md](./11-apps.md) |
| 12 | 分析 Analyst | —（看板 + NL 生成） | 真实 | [12-analyst.md](./12-analyst.md) |

> 跨模块技术文档已并入对应模块：**实时链路架构设计 + 规模扩展对照** 见 [00-platform](./00-platform.md)；**ID-Mapping 画像水平伸缩方案 + MCP 调用链路** 见 [02-unify](./02-unify.md)。
> 全局能力（非独立一级菜单）：**智能助手**（右上角，多智能体：数据查询/分析/任务/导航，见 [00-platform](./00-platform.md)）· **登录门禁**（团队成员即账号，见 [09-settings](./09-settings.md)）。
> 辅助文档：[page-routes.md](./page-routes.md) —— 全部功能页面路由表，智能助手默认加载用于「打开页面」导航。

## 文档模板（每个模块统一结构）

1. **概述** —— 定位、对标 Segment 的哪块、当前真实/Mock 状态。
2. **详细设计（产品）** —— 子功能清单、信息架构与页面、关键用户流程、数据模型。
3. **技术设计** —— 前端（页面/组件/状态/API）、后端（服务/端点/表，标「已实现/待建」）、真实 vs Mock 边界、依赖与集成。
4. **TODOs** —— 按 P0/P1/P2 分阶段，每条标 `[前端]/[后端]/[数据]`，注明「把 Mock 接真」的落地路径。

## 全局约定

- **真实数据链路**：前端 `/api/*` →（dev: vite 代理 / 生产: nginx）→ **SQL Engine `:8002`** / **ID-Mapping `:8001`** → **MySQL `:3308`**。
- **多租户**：所有查询按 `tenant_id` 隔离；前端顶栏 Workspace 切换（1001/1002）。
- **Mock 标注**：未接后端的页面右上角有「Mock 数据」角标（`components/segment/kit.tsx` 的 `MockTag`）。
- **前端目录**：页面 `frontend/src/pages/`（真实）与 `frontend/src/pages/segment/`（Mock）；路由 `frontend/src/App.tsx`；导航 `frontend/src/lib/nav.ts`；UI 套件 `frontend/src/components/ui.tsx` + `components/segment/kit.tsx`；Mock 数据 `frontend/src/mock/data.ts`。
- **后端模块**（`services/sql-engine/`）：`objects.py`(多对象+关系 DSL)、`dsl.py`/`engine.py`(规则→SQL)、`etl.py`、`segments.py`、`groups.py`、`tags.py`、`agent.py`+`nl_query.py`(自然语言)、`executor.py`(OLAP 执行)。`services/id-mapping/`：OneID 识别/merge/画像。
