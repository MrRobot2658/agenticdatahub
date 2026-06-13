# CDP 全量实现蓝图（按 V3.0-06 + CDP Agent 规划）

> 版本 v1.0 | 2026-06-13 | 规划阶段（本轮不写代码）
> 来源文档：`CDP优化方案V3.0-06.pdf`（12 页，最新）+ `CDP Agent.pdf`（5 页）+ `design.md`（v1.1，已落地）
> 目标：把文档 Ch3（多对象）/ Ch4（NL Segment·CDP Agent）/ Ch6（智能数据底座）/ Ch7（高风险兜底）落到本仓库的文件级任务清单。

---

## 实现进度

- ✅ **S1 多对象接入与筛选**（2026-06-13）：`sql/migrate_objects.sql`（Lead/Account/Product/Store + object_relations + 模拟数据）、`services/sql-engine/objects.py`（注册表驱动跨对象 JOIN，≤3 跳硬约束、字段/操作符白名单校验、人数预估）、`/objects/meta·upsert·relations·search` 端点、`scripts/apply_migrations.sh`（修复管道导入中文乱码）、`scripts/simulate_objects.py`、`tests/test_multi_object.py`（10 项全通过）。文档示例「上海+规模>500 且关联用户VIP」→ L2001/L2005，跨对象点查 < 3ms。
- ✅ **S2 DSL/SQL 验证层**（2026-06-13）：`services/sql-engine/dsl.py`（DSL Rule：validate / echo 翻译 / compile→SQL / dry-run estimate，支持 AND/OR 嵌套组）、`segments.py` + `sql/migrate_segments.sql`（人群规则保存，保存前强制校验+预估）、端点 `/metadata/{tenant}/fields`、`/dsl/validate·echo·compile·estimate`、`/segments`。`tests/test_dsl_engine.py`（13 项）+ 全量回归 43 passed。echo 示例输出「筛选线索满足（city 等于 上海 且 company_size 大于 500）且 其归属于的用户满足（tags 包含 vip）」。
- ✅ **S3 NL 圈人**（2026-06-13）：`services/sql-engine/agent.py`（NL→候选 DSL：确定性规则解析 + DeepSeek 兜底，模糊词如「近期活跃」触发澄清不猜测，复用 S2 校验/echo/estimate），端点 `/agent/segment/draft`（NL→规则+解释+人数预估 或 澄清）、`/agent/segment/confirm`（确认走保存链路 source=nl-agent）。`AGENT_LLM_ENABLED=0` 可降级为纯规则。`tests/test_agent_nl.py`（9 项含 DeepSeek）；sql-engine 域 51 passed。
- ✅ **S4 stdio MCP**（2026-06-13）：`services/mcp/server.py`（FastMCP，7 个只读工具：`cdp_schema/search/estimate/validate/translate/nl_segment/list_segments`，调 sql-engine，`trust_env=False` 绕代理）、`.mcp.json`（项目级 stdio 配置）、`services/mcp/requirements.txt`、`services/mcp/README.md`。`tests/test_mcp_server.py`（5 项 stdio 端到端）。`claude mcp list` 已发现 `cdp`（待用户首次 `claude` 内审批）。
- ⏳ S5 Claude 验证（待用户在 Claude 内审批 MCP 后，用自然语言验证结果+速度）

---

## 0. 现状盘点（已完成，作为基线）

文档 **Ch2（OneID 改造 + 水平扩展）已在本仓库完整模拟实现**，作为后续工作的基线，不在本蓝图重做：

| 已实现 | 文件 |
|--------|------|
| Flink Job-1 模拟（Redis 热 / MySQL 冷 / Doris-sim、跨渠道 merge、profile upsert、merge_log） | `services/id-mapping/main.py` |
| OLAP 查询层：14 模板 + groups + tags + NL 查询（规则 + DeepSeek） | `services/sql-engine/`（`engine.py`/`nl_query.py`/`groups.py`/`tags.py`/`executor.py`） |
| 数据库 schema + 迁移 | `sql/init.sql`、`sql/migrate_*.sql` |
| Flink 生产 Job 模板 | `docs/flink/`（Java DataStream + SQL） |
| 规模分级 / Docker / 测试 | `config/scale-tiers.yaml`、`docker-compose.yml`、`scripts/scale-up.sh`、`tests/` |

**本地架构映射约定（沿用 design.md）：** 生产 Doris → MySQL `doris_*` 表模拟；生产三引擎（filter/query/rule engine）→ 本地由 `sql-engine` 统一承担；`OLAP_BACKEND=mysql|doris` 切换后端。

---

## 1. 总体技术路线（与文档 Ch4.1 对齐）

文档关键原则（必须在实现中守住）：

1. **LLM 只做意图理解，不直接拼 SQL、不直接发规则、不绕过权限**。
2. 候选 DSL **必须经过 Filter/Query Engine 校验 + 人数预估** 才展示。
3. 用户确认后才走**现有规则保存链路**（本地 = `user_groups` / 新增 `segments` 表）。
4. AI 层可**降级关闭**，不影响底层筛选/查询/规则能力。

本地落地路线：

```
客户自然语言
  → cdp-agent（新服务 :8003）
  → sql-engine /metadata 拉字段/操作符/枚举 schema
  → LLM 意图理解 → 受控中间表示（IR）
  → 语义落地：IR → 真实字段/枚举 → 候选 dsl.Rule
  → sql-engine /dsl/echo 回显翻译 + /dsl/validate 结构校验
  → sql-engine /dsl/estimate dry-run 人数预估
  → 输出 {候选规则, 解释, 置信度, 澄清问题, trace}
  → 用户确认 → sql-engine /segments 保存
```

新增服务采用与现有服务一致的 FastAPI + Pydantic 风格，复用 `MYSQL_CONFIG` / `REDIS` 连接约定与 `ROOT_PATH` 网关前缀。

---

## 2. 分阶段蓝图（对齐文档时间线）

文档时间线：6–9 月功能线（超级租户→ABM→自定义对象）+ 性能线（已完成 Ch2）；CDP Agent 三期穿插；10–12 月智能数据底座。下表为**本仓库的工程实施阶段**（E = Epic）：

| 阶段 | 对应文档 | 内容 | 依赖 |
|------|---------|------|------|
| **E1 · DSL + 引擎门面** | Ch4.1–4.3 | sql-engine 暴露 metadata / dsl validate / echo / estimate / segments，作为 Filter+Query+Rule Engine 本地代理 | 现状 |
| **E2 · 多对象数据模型** | Ch3 | Lead/Account/Product/Store 表 + `object_relations` + 跨对象 JOIN（≤3 跳） | E1 |
| **E3 · cdp-agent Phase 1** | Ch4 Phase 1 | 新服务：NL 圈人、规则解释、人数预估、多轮澄清、只读 MCP | E1 |
| **E4 · cdp-agent Phase 2** | Ch4 Phase 2 | 跨对象 NL、规则翻译、「为什么没圈中」、规则体检 | E2,E3 |
| **E5 · Hybrid Search** | Ch4 Phase 3 / 4.4–4.5 | sql-engine 内部 AI-only 选项/文本召回（Doris 倒排 + 向量 ANN 模拟） | E3 |
| **E6 · 评估·观测·治理** | Ch4.6 | 黄金评测集、质量指标、审计 trace、降级开关 | E3 |
| **E7 · 高风险兜底** | Ch7 | ID 冲突仲裁 + conflict_log、灰度/回滚开关、配额限流模拟 | 现状 |
| **E8 · 智能数据底座** | Ch6 | 可视化 ETL→多对象、多模态→结构化/向量、NL 语义层、统一 MCP/API | E2,E5 |

> 优先级建议：**E1 → E3 → E2 → E4 → E5/E6/E7 → E8**。E1 是所有 AI 能力的确定性底座，先行。

---

## 3. E1 · DSL + 引擎门面（sql-engine 扩展）

**目标：** 把 `sql-engine` 包装成 AI 可安全调用的「Filter + Query + Rule Engine」工具链（文档 Ch4.2「复用确定性引擎」）。

### 3.1 DSL 数据结构（受控中间表示）

新增 `services/sql-engine/dsl.py`：

```python
# Condition: 单条件
{ "object": "user", "field": "amount", "op": "gt", "value": 10000 }
# Relation: 跨对象关联条件（E2 启用）
{ "object": "lead", "relation": "belongs_to",
  "target": { "object": "user", "conditions": [ {"field":"tags","op":"contains","value":"vip"} ] } }
# Rule: 逻辑组合
{ "object": "user", "logic": "AND",
  "conditions": [ Condition | Relation | Rule ] }
```

- 操作符白名单：`eq/ne/gt/ge/lt/le/in/not_in/contains/between/exists/is_null`。
- 字段必须属于 metadata 注册表（不存在/无权限字段直接拒绝）。
- JSON Schema 化，供 cdp-agent 强约束 LLM 输出与本地结构校验。

### 3.2 字段元数据注册表（Filter Engine 代理）

新增 `services/sql-engine/metadata.py` + `services/sql-engine/metadata/fields.yaml`：

- 描述每个对象（user/lead/account/product/store）的字段：`code / label / type / object / operators[] / enum_source / pii / behavior?`。
- 枚举与动态选项：静态写 yaml；动态（标签、来源、活动…）从 `tag_definitions` / Doris-sim 查询。
- 权限：按 `tenant_id` 过滤可见字段（本地用 tenant 配置模拟）。

### 3.3 新增 sql-engine 端点

| 端点 | 作用 | 对应文档 |
|------|------|---------|
| `GET /metadata/{tenant_id}/objects` | 列对象类型 | Ch3 metadata |
| `GET /metadata/{tenant_id}/fields?object=` | 字段树 + 操作符 + 枚举 | Ch4.2 filter engine |
| `POST /dsl/validate` | 结构校验：字段存在/操作符合法/类型匹配 | Ch4.3 验证器闭环 |
| `POST /dsl/echo` | 规则回显 + 翻译成业务可读摘要 | Ch4 规则翻译 |
| `POST /dsl/compile` | DSL → SQL（不执行，返回 SQL） | Ch4.1 query engine |
| `POST /dsl/estimate` | dry-run 人数预估（COUNT，带超时熔断） | Ch4 人数预估 |
| `POST /segments` / `GET /segments/{tenant_id}` | 保存/列出 Segment（落 `user_groups` 体系） | Ch4 保存链路 |
| `POST /dsl/diagnose` | 规则体检：空集/矛盾/冗余/操作符误用/字段不可用 | Ch4 Phase 2 |
| `POST /dsl/explain-membership` | 「某用户为何没被圈中」逐条件判定 | Ch4 Phase 2 |

> `compile` / `estimate` 复用现有 `executor.py` + `OLAP_BACKEND` 切换；估算走 `SELECT COUNT(*)`，套用现有 limit/超时约束（Ch2 SLO：20 组条件 P99 在 dev <1.5s）。

### 3.4 测试

`tests/test_dsl_engine.py`：DSL 校验（合法/非法字段/非法操作符）、compile SQL 快照、estimate 计数、segment 保存往返、diagnose 命中空集/矛盾。

---

## 4. E2 · 多对象数据模型（文档 Ch3）

**目标：** User 单实体 → User + Lead + Account + Product + Store + `object_relations`，支持跨对象 JOIN 圈选。

### 4.1 新增表（`sql/migrate_objects.sql`，MySQL + doris_ 模拟）

| 对象 | 主键 | 表 | 典型字段（文档图 5） |
|------|------|----|---------------------|
| Lead 线索 | lead_id | `object_lead` | city, company_size, source, stage |
| Account 账户 | account_id | `object_account` | name, industry, scale |
| Product 商品 | product_id | `object_product` | sku, category, price |
| Store 门店 | store_id | `object_store` | region, address |
| 关联 | 复合 | `object_relations` | tenant_id, src_type, src_id, **rel_type**, dst_type, dst_id |

关联矩阵（文档图 6，存 `object_relations`）：
`User—belongs_to→Lead`、`User—owns→Account`、`User—visited→Store`、`Account—purchased→Product`。维护**双向边**（Ch7 H2 反向关联索引）。

### 4.2 跨对象查询

- `dsl.py` 的 Relation 节点 → `dsl/compile` 生成 JOIN（经 `object_relations`）。
- **硬约束：JOIN ≤ 3 跳**（Ch7 H2），超跳拒绝并引导走预计算宽表。
- 示例（文档 Ch3.3）：「地址在上海、公司规模>500 的线索，且关联用户带 VIP 标签」
  → `object=lead + relation.belongs_to(user.tags contains vip)` → Doris JOIN。

### 4.3 端点 + 测试

- `metadata` 扩展返回多对象字段与 relation 定义。
- `tests/test_multi_object.py`：建对象 + 关联 → 跨对象圈选返回正确集合、3 跳上限拦截、反向查询（查门店全部访客）。

---

## 5. E3 · cdp-agent 服务 Phase 1（文档 Ch4 Phase 1）

**目标：** 新建独立服务 `services/cdp-agent/`（端口 8003，gateway `ROOT_PATH=/CDP-Agent`），不把 LLM 逻辑塞进现有引擎（文档 Ch4.2）。

### 5.1 目录结构

```
services/cdp-agent/
  main.py            # FastAPI 入口 + 端点
  agent.py          # 编排：NL → IR → 落地 → 校验 → 估算 → 输出
  llm.py            # DeepSeek 客户端（复用 .env DEEPSEEK_*），意图抽取 + 模糊识别
  grounding.py      # 字段语义落地：IR → 真实字段/枚举（调 sql-engine /metadata）
  engine_client.py  # 调 sql-engine /dsl/* 与 /segments 的 HTTP 客户端
  mcp_tools.py      # 只读 MCP 工具定义
  prompts/          # 意图抽取 / 澄清 / 解释 prompt 模板
  Dockerfile
  requirements.txt
```

### 5.2 编排流程（agent.py）

1. 入参：`tenant_id, question, scene, object, mode, user_ctx`。
2. `llm.py` 抽取意图 → 受控 IR（含模糊表达标记，如「高价值」「近期活跃」）。
3. 模糊表达 → **不强行猜测，返回澄清问题**（多轮澄清，Ch4 Phase 1）。
4. `grounding.py`：IR 字段/取值映射到 metadata 真实字段/枚举；映射失败 → 澄清。
5. 构造候选 `dsl.Rule` → 调 `/dsl/validate` + `/dsl/echo`（结构校验 + 回显翻译）。
6. 调 `/dsl/estimate` 做人数预估（dry-run）。
7. 输出 `{rule, explanation[每条件:字段/操作符/取值/默认假设], confidence, clarifications[], estimate_count, trace_id}`。
8. 用户确认 → 调 `/segments` 保存。

### 5.3 端点

| 端点 | 作用 |
|------|------|
| `POST /agent/segment/draft` | NL → 候选规则 + 解释 + 人数预估 + 澄清 |
| `POST /agent/segment/clarify` | 提交澄清答复，回到 draft 继续 |
| `POST /agent/segment/confirm` | 确认保存 Segment |
| `POST /agent/explain` | 规则解释（每条件说明字段/操作符/取值/默认假设） |
| `GET /health` | 含 LLM 可用性 + 降级状态 |

### 5.4 基础只读 MCP（mcp_tools.py，文档 Ch4.4）

只读工具（Phase 1）：`query_field_schema`、`search_enums`、`get_object_entity`（点查线索等）、`estimate_segment_size`、`validate_dsl`、`translate_rule`。封装为 MCP server（stdio / HTTP）。**只读、不写规则、不绕权限。**

### 5.5 集成

- `docker-compose.yml` 增 `cdp-agent` 服务（depends_on sql-engine），nginx 增路由 `/CDP-Agent`。
- `tests/test_cdp_agent.py`：NL→候选规则（mock LLM）、模糊表达触发澄清、确认保存、字段不存在被引擎拦截、LLM 关闭时降级返回纯规则模式。

---

## 6. E4 · cdp-agent Phase 2（文档 Ch4 Phase 2）

在 E3 + E2 之上，把 Agent 从「配规则」扩到「理解和诊断规则」：

| 能力 | 实现 |
|------|------|
| 跨对象 NL 圈人 | grounding 支持 relation；调 E2 多对象 compile |
| 已有规则翻译 | 复用 `/dsl/echo`，复杂嵌套 → 业务摘要 |
| 为什么没圈中 / 是否匹配 | 调 `/dsl/explain-membership`（逐条件对单 user 判定） |
| 规则体检 | 调 `/dsl/diagnose`（空集 / 条件矛盾 / 冗余 / 操作符误用 / 字段不可用） |

端点：`POST /agent/diagnose`、`POST /agent/why-not-matched`、`POST /agent/translate`。
测试：`tests/test_agent_diagnose.py`。

---

## 7. E5 · Query Engine AI-only Hybrid Search（文档 Ch4 Phase 3 / 4.4–4.5）

**目标：** sql-engine 内新增**仅供 AI 编排层调用**的 hybrid search（不暴露为客户可见筛选器）。

### 7.1 两类内部能力

- **选项解析模块**（`/internal/hybrid/options`）：入 `nl, object, field_scope, user_ctx` → 候选选项 `{id,label,field_code,score,evidence,permission}`。面向行业/地区/来源/阶段/标签/活动/渠道等选项型字段（「制造业客户」「私域增长相关标签」）。
- **文本搜索**（`/internal/hybrid/text`）：入 `nl, object, text_fields[], base_dsl?` → `{字段, 文本片段, 相关性分数, 证据}`。面向备注/描述/表单内容/页面标题等**非 PII**文本字段。

### 7.2 本地索引模拟（生产 = Doris 4.x 倒排 + BM25 + 向量 ANN）

- `sql/migrate_hybrid.sql`：
  - `option_index`（tenant, field, option_id, label, alias, desc, biz_tags）— 选项语义召回。
  - `text_evidence_index`（object_id, field_code, snippet, update_time, source, perm_ctx）— **仅白名单非 PII 文本**。
  - `index_version`（tokenizer, embedding_model, field_whitelist, schema_hash, build_time）— 防用过期/不兼容召回。
- 本地召回：MySQL `LIKE`/`FULLTEXT` 模拟倒排 BM25；向量用轻量 embedding（可选，DeepSeek/本地）+ 余弦近似。`OLAP_BACKEND=doris` 时切真 Doris `MATCH_*`。

测试：`tests/test_hybrid_search.py`（选项 TopK 命中、文本证据返回、PII 字段被拒、索引版本校验）。

---

## 8. E6 · 评估·观测·治理（文档 Ch4.6，从 Phase 1 就建）

| 项 | 实现 |
|----|------|
| 黄金评测集 | `tests/golden/segment_cases.yaml`：文本/数字/日期/枚举/boolean/标签/行为/PII/字段多义/枚举重名 |
| 核心质量指标 | 一次生成成功率、dry-run 通过率、人工修改率、澄清后成功率、低置信度拦截率 → `scripts/eval_agent.py` 跑评测集出报表 |
| Hybrid 指标 | 选项召回 TopK 命中率、文本证据采纳率、误召回率、索引新鲜度 |
| 系统指标 | 响应时间、模型调用成本、cache 命中率、自动修复成功率（cdp-agent 中间件埋点） |
| 审计 trace | `agent_trace` 表 / 日志：request_id, object, 候选 DSL hash, 校验结果, 失败原因（**敏感脱敏**） |
| 降级开关 | `AGENT_LLM_ENABLED` 环境变量；关 → 纯规则/模板模式，不影响底层 |

---

## 9. E7 · 高风险项兜底（文档 Ch7，承接已实现的 OneID 链路）

| 风险项 | 实现到本地 |
|--------|-----------|
| **H1 ID 冲突仲裁**（最易漏） | `id-mapping/main.py` 合并逻辑增仲裁：强标识(登录)>弱标识(设备)>时间衰减>共享设备降级；并查集合并记 `merge_reason`；仲裁失败写新表 `conflict_log` 不强行合并；`oneid_conflict_rate` 指标 |
| **H1 状态一致性** | merge 后主动失效 Redis channel key（已部分）+ 查询侧 Cache-Aside + 布隆过滤器模拟 miss 限速回查 |
| **H1 灰度/回滚** | 配置开关 `ONEID_ROUTE=new|old`（配置中心模拟）；新旧链路双写不同命名空间；对账作业 `scripts/reconcile_oneid.py` |
| **H2 跨对象性能边界** | E2 中 JOIN ≤3 跳硬校验 + 反向边物化 + 高频组合（>50 次/天）建议沉淀宽表（热度统计脚本） |
| **H3 多租户隔离水位** | 配额/限流模拟：`config/tenant_quota.yaml`（软限 80% 告警 / 硬限 100% 令牌桶）；单租户对资源占用硬上限 ≤50% |

`sql/migrate_conflict.sql` 新增 `conflict_log(tenant_id, device/channel, old_one_id, new_one_id, reason, status, created_at)`。
测试：`tests/test_id_conflict.py`（强标识改绑、共享设备降级、仲裁失败入 conflict_log）。

---

## 10. E8 · 智能数据底座（文档 Ch6，10–12 月，最远期）

仅规划，落地排在最后：

| 月 | 能力 | 本地落点 |
|----|------|---------|
| 10 月 | 可视化 ETL → 多对象 | `services/etl/`：拖拽配置（JSON pipeline）→ 写入多对象模型（复用 E2 表） |
| 11 月 | 多模态非结构化处理 | `services/ingest/`：文档/图像/音视频 → 结构化字段抽取 + 向量化入库（扩充 E5 索引） |
| 12 月 | NL 语义层优化 | 复用 cdp-agent + hybrid search，优化 Segment/Tag/Group 生成召回准确率 |
| 贯穿 | Agent 数据底座 = MCP/API 统一供给 | 把 E1/E3/E5 能力统一封装为 MCP（扩展 E3 的 mcp_tools） |

---

## 11. 文件改动总览（落地时新建/修改）

**新建：**
```
services/cdp-agent/                         # E3/E4/E6 整服务
services/sql-engine/dsl.py                  # E1 DSL 结构 + 校验/编译
services/sql-engine/metadata.py             # E1 字段元数据
services/sql-engine/metadata/fields.yaml    # E1 字段定义
sql/migrate_objects.sql                     # E2 多对象 + object_relations
sql/migrate_hybrid.sql                      # E5 hybrid 索引表
sql/migrate_conflict.sql                    # E7 conflict_log
config/tenant_quota.yaml                     # E7 配额
scripts/eval_agent.py                        # E6 评测
scripts/reconcile_oneid.py                   # E7 对账
tests/test_dsl_engine.py / test_multi_object.py / test_cdp_agent.py
tests/test_agent_diagnose.py / test_hybrid_search.py / test_id_conflict.py
tests/golden/segment_cases.yaml
```

**修改：**
```
services/sql-engine/main.py     # 挂载 dsl/metadata/segment/diagnose 端点
services/id-mapping/main.py     # H1 ID 冲突仲裁 + merge_reason + conflict_log
docker-compose.yml              # 新增 cdp-agent 服务 + nginx 路由
docker/nginx 配置               # /CDP-Agent 路由
.env.example                    # AGENT_LLM_ENABLED / ONEID_ROUTE 等开关
README.md / docs/swagger        # 文档与 openapi 更新
```

---

## 12. 验收对齐（文档 Ch2 SLO + Ch7 验收标准）

落地时每个 Epic 的验收锚定文档原文：

- **人数预估 / 圈选**：dev 单条件 <0.3s、20 组条件 <1.5s（Ch2 SLO 表）。
- **H1**：亿级映射不 OOM、checkpoint <30s（本地模拟以逻辑正确性 + conflict_rate <0.5% 验收）。
- **H2**：4 跳以上 100% 拦截；反向查询无全表扫描。
- **H3**：单租户限流不影响其他租户；单租户资源占用 ≤50% 硬上限。
- **Agent**：一次生成成功率 / dry-run 通过率 / 澄清后成功率达标（黄金评测集基线）。

---

## 13. 已确认决策（2026-06-13）

1. **E5 接入向量 embedding**：hybrid search 接入 embedding + ANN，不止 BM25/LIKE。
2. **cdp-agent 不独立服务**：AI 编排能力并入 `sql-engine` 子路由（`/agent/*`），不新建 :8003 服务。
3. **MCP = stdio**：做成 stdio MCP server，接入 Claude。
4. **生成多对象模拟数据**：扩展 `scripts/simulate_channels.py` / 新增脚本造 Lead/Account/Product/Store + relations。
5. **落地顺序（已调整）**：
   - **S1** 多对象接入 + 筛选（建表 + 模拟数据 + 跨对象 JOIN 查询）
   - **S2** sql-engine SQL 验证层（DSL → 校验 / 回显 / compile / dry-run 人数预估）
   - **S3** 接入 NL（NL → 候选 DSL，并入 sql-engine `/agent/*`）
   - **S4** 做成 stdio MCP server，接入 Claude
   - **S5** 在 Claude 里用自然语言验证多对象筛选的**结果正确性 + 查询速度**
```
