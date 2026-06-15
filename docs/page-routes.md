# 功能页面路由（智能助手导航用）

智能助手默认加载本表；当用户想「打开 / 前往 / 跳转到」某页面时，调用 `open_page(path)`，`path` 必须取自下表。
格式：`- \`路由\` — 名称 · 说明`（解析按此格式，勿改）。

## 总览

- `/` — 总览看板 · 核心 KPI + 关键图表（可下钻）

## 连接 Connections

- `/connections` — 数据源 · 数据源列表
- `/connections/catalog` — 数据源目录 · 44 个连接器平铺，点卡片建数据源
- `/connections/flow` — 可视化编排 · 拖拽节点编排 ETL
- `/connections/pipelines` — 管道 · 管道列表 → 详情（Airflow 执行/历史/暂停）
- `/connections/destinations` — 目的地 · 下游激活目录
- `/connections/reverse-etl` — Reverse ETL · 数仓回流任务
- `/connections/warehouses` — 数据仓库 · 连接数仓与同步
- `/connections/functions` — Functions · 自定义转换

## 用户 Unify

- `/unify` — 用户档案 · 按标识符/属性检索用户宽表
- `/unify/identity` — 身份解析 · channel→OneID 合并规则
- `/unify/traits` — 计算特征 · 标签体系与覆盖
- `/unify/groups` — 群组 · 用户群组
- `/unify/sql-traits` — SQL 特征 · 自定义 SQL 生成特征
- `/unify/predictions` — 预测 · 购买/流失/LTV 模型
- `/unify/sync` — 档案同步 · 回流数仓

## 对象 Objects

- `/objects` — 对象 · 对象 ER 图 + 每对象记录列表
- `/objects/model` — 对象模型 · 对象/字段/关系定义
- `/objects/store` — 门店 · 门店主数据
- `/objects/product` — 产品 · 产品主数据
- `/objects/order` — 订单 · 订单主数据

## 客户 Accounts

- `/accounts` — 客户列表 · B2B 客户主数据

## 知识库 Knowledge

- `/knowledge` — 知识库 · 云盘式多模态文件存储，可关联对象

## 应用 Apps

- `/apps` — 应用 · 应用市场（CRM/广告/消息/分析），连接/断开

## 分析 Analyst

- `/analyst` — 看板列表 · 内置 + 自定义看板，NL 新建
- `/analyst/dashboards/user` — 用户画像看板 · 用户/线索 KPI 与分布
- `/analyst/dashboards/account` — 客户画像看板 · 客户/订单 KPI 与分布
- `/analyst/dashboards/roi` — 转化率ROI看板 · 转化率/支付率/GMV

## 触达 Engage

- `/engage` — 受众 · 已保存人群包
- `/engage/audiences/new` — 创建受众 · 多条件/跨对象/自然语言圈人
- `/engage/journeys` — 旅程 · 多步自动化触达
- `/engage/broadcasts` — 群发 · 一次性触达

## 协议 Protocols

- `/protocols` — 埋点计划 · 事件 Schema 校验
- `/protocols/violations` — 违规 · 不合规上报
- `/protocols/transformations` — 转换 · 入库前改写

## 隐私 Privacy

- `/privacy` — 数据管控 · PII 检测与管控
- `/privacy/consent` — 同意管理 · 分类与厂商映射
- `/privacy/deletion` — 删除与抑制 · GDPR 请求

## 监控 Monitor

- `/monitor` — 投递概览 · 吞吐/成功率/趋势
- `/monitor/alerts` — 告警 · 阈值告警
- `/monitor/logs` — 事件日志 · 逐事件投递

## 设置 Settings

- `/settings` — 通用 · 工作区信息
- `/settings/access` — 权限管理 · IAM 成员/角色/团队
- `/settings/tokens` — API 令牌 · 服务端凭证
- `/settings/audit` — 审计日志 · 关键操作记录
- `/settings/mcp` — MCP 设置 · 智能助手可调用的 MCP 工具
- `/settings/tenants` — 租户管理 · 平台级租户治理
