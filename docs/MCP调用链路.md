# CDP MCP 调用链路（自然语言 → DSL → SQL → Doris）

> 本文描述只读 MCP Server 从「Claude 发起工具调用」到「Doris/OLAP 返回结果」的完整链条，
> 以及各层职责、关键约束与可观测点。代码实证位置随文标注。

## 1. 分层总览

```
Claude（LLM）
   │  MCP tool call（stdio / JSON-RPC）
   ▼
① services/mcp/server.py            MCP 工具壳层（只读、薄代理）
   │  HTTP（httpx，trust_env=False 绕本机代理）
   ▼
② services/sql-engine/main.py       FastAPI 路由层
   │  方法调用
   ▼
③ services/sql-engine/dsl.py        DSL 校验 / 编译 / 预估 / 翻译（DslEngine）
   │
   ▼
④ services/sql-engine/objects.py    对象元数据 + build_sql（DSL→SQL）+ search
   │  SQL + params
   ▼
⑤ services/sql-engine/executor.py   OlapExecutor（MySQL模拟 / Doris 可切换）
   │  MySQL 协议（pymysql）
   ▼
⑥ Doris / MySQL                     doris_user_wide ⋈ object_relations ⋈ … → COUNT / 明细
```

## 2. 各层职责

### ① MCP 壳层 — `services/mcp/server.py`
- 用 `FastMCP("cdp")` 暴露 7 个**只读**工具,逐一映射到 sql-engine 的 HTTP 接口:

  | MCP 工具 | sql-engine 接口 | 作用 |
  |---|---|---|
  | `cdp_schema` | `GET /metadata/{tenant}/fields` | 对象/字段/关联矩阵 |
  | `cdp_search` | `POST /objects/search` | 跨对象筛选 + 明细 |
  | `cdp_estimate` | `POST /dsl/estimate` | dry-run COUNT 人数预估 |
  | `cdp_validate` | `POST /dsl/validate` | 结构/字段/关联/跳数校验 |
  | `cdp_translate` | `POST /dsl/echo` | DSL → 中文摘要 |
  | `cdp_nl_segment` | `POST /agent/segment/draft` | NL → 候选 DSL（经 DeepSeek） |
  | `cdp_list_segments` | `GET /segments/{tenant}` | 列已存 Segment |

- 只生成 / 预估 / 校验,**不写规则、不绕权限**(保存仍走人工确认链路)。
- `tenant_id` 默认 1001(`CDP_TENANT_ID`),全链路透传做租户隔离。

### ② FastAPI 路由 — `main.py`
- 接 HTTP,做 Pydantic 入参校验,转交 `DslEngine` / `ObjectService`。
- 出错统一翻成 `HTTPException`(400 校验失败 / 409 重复 / 500)。

### ③ DSL 引擎 — `dsl.py`（核心原则:LLM 不直接拼 SQL）
- `validate`：借编译期校验,检查字段存在 / 操作符合法 / 关联已定义 / **跳数 ≤ 3**。
- `compile`：DSL → SQL（不执行）。
- `estimate`：走 `objects.search(count_only=True)`,只 COUNT、不取明细。
- `echo`：DSL → 业务可读中文摘要 + 逐条件解释。

### ④ 对象服务 — `objects.py`（DSL → SQL 真正发生处）
- `OBJECT_REGISTRY`：逻辑对象 → 物理表映射,如 `user → doris_user_wide(主键 one_id)`。
- `RELATION_MATRIX`：合法关联,如 `account-purchased->product`、`user-owns->account`。
- `build_sql` / `_build_relations`：把 DSL 树编译成 SQL：
  - base 条件 → `WHERE`,支持 AND/OR 嵌套组;
  - 每个 relation → 两段 `JOIN`(先 JOIN `object_relations` 关系表,再 JOIN 目标对象表),`forward/reverse` 双向;
  - **链式多跳(递归)**：relation 可嵌套 `relations`,每跳 target 成为下一跳锚点
    (`user→owns→account→purchased→product`),第 N 跳 JOIN 锚在第 N-1 跳的别名上,而非 base `t0`;
  - `count_only` → `SELECT COUNT(DISTINCT t0.<id>)`;否则 `DISTINCT t0.* … LIMIT`;
  - **MAX_HOPS 守卫**：按整棵关系树的**总跳数**(`_count_hops`)> 3 直接抛错拒绝(保护 OLAP JOIN);
  - 全部走 `%(name)s` 命名参数,值与 SQL 分离(防注入)。
  - **边条件 `edge_conditions`**：作用在**关系行**(`object_relations` 别名 `r{i}`)上,
    字段限白名单 `create_time` 与 `properties.<key>`(后者经 `JSON_EXTRACT`),
    支持 eq/ne/gt/ge/lt/le/in/not_in/between/like。用于"购买发生在最近30天"这类**边时间/属性**过滤。
    注意:`create_time` 是 DATETIME,`between` 上界写日期(如 `2026-06-13`)会被当成当天 00:00:00,
    需覆盖当天整天时上界取次日(`2026-06-14`)。

### ⑤ 执行器 — `executor.py`（存储解耦）
- `OlapExecutor` 抽象,`OLAP_BACKEND` 环境变量切换:
  - `mysql`（默认,本地开发）→ `MysqlOlapExecutor`,连本机 3308 端口的 MySQL 模拟 Doris 宽表;
  - `doris`（生产）→ `DorisOlapExecutor`,走 Doris FE 的 MySQL 协议端口 9030,库名 `tenant_1001`。
- 两者接口一致(`execute(sql, params)` / `health()`),上层无感知。

### ⑥ Doris / MySQL
- 宽表 `doris_user_wide` + 关系表 `object_relations` + 维度对象表。
- 实际扫描 / 过滤 / JOIN / 聚合在此完成;`elapsed_ms` 即此层执行耗时。

## 3. 一次「过去30天有过购买的用户」的端到端走向

这条用例同时用到三项能力:**链式多跳** + **边条件** + **NL 自动生成**。

```
NL: "过去30天有过购买的活跃用户"
 ① cdp_nl_segment（规则路径，无需 LLM）
    - _event_relations 识别「过去30天」+「购买」
    - 时间窗用服务端时钟算：today(2026-06-13) - 30 天 = 2026-05-14（用 ge，不用 between）
    - 生成链式 DSL：user →owns→ account →purchased→ product
      其中 purchased 带 edge_conditions: create_time ge 2026-05-14
    - "活跃"在带明确时间窗时不再硬触发澄清；needs_clarification=false
 ② cdp_validate   → ok:true（owns/purchased 关联、2 跳、create_time 边字段 均合法）
 ③ cdp_estimate   → 递归 _build_relations 编译 SQL：
      SELECT COUNT(DISTINCT t0.one_id) AS cnt
      FROM doris_user_wide t0
      JOIN object_relations r1 ON … rel_type='owns'     AND r1.src_id=CAST(t0.one_id AS CHAR) …
      JOIN object_account   u1 ON u1.account_id=r1.dst_id
      JOIN object_relations r2 ON … rel_type='purchased' AND r2.src_id=u1.account_id …   ← 锚在上一跳 account
      JOIN object_product   u2 ON u2.product_id=r2.dst_id
      WHERE t0.tenant_id=%(tenant_id)s
        AND (r2.create_time >= %(p1)s)          ← 边条件落在关系行 r2，而非 product
 ④ executor → MySQL/Doris 执行 → COUNT=1，elapsed_ms ~1ms
```

> 历史坑(已修)：早期 `build_sql` 不递归嵌套 relations，第二跳 purchased + 时间过滤被静默丢弃，
> 任何时间窗都返回 2(其实是"名下有 account 的用户")。修复后正确返回 1。详见第 6 节。

## 4. 关键约束与设计点
- **职责分层干净**：前三步(nl/schema/validate)不碰真实数据,只有 estimate/search 落库。
- **逻辑对象与物理表解耦**：DSL 写逻辑名,`OBJECT_REGISTRY` 编译时换物理表名。
- **跳数 ≤ 3 硬约束**：防 JOIN 爆炸,validate 阶段即拦截。
- **命名参数**：SQL 与取值分离,防注入。
- **租户隔离**：`tenant_id` 全链路透传 + `WHERE tenant_id=…`,共表多租户。
- **存储可切换**：`OLAP_BACKEND` 一键在「本地 MySQL 模拟」与「生产 Doris」间切。

## 5. 可观测性
- MCP 层对每次查询记录 **SQL** 与 **MCP 调用→返回耗时**,日志见
  `services/mcp/logs/mcp_queries.log`(详见 `services/mcp/README.md`)。
- sql-engine 各响应内含 `elapsed_ms`(数据库执行耗时),与 MCP 层的 round-trip 耗时互补:
  二者之差 ≈ HTTP + 编译 + 序列化开销。

## 6. 链式多跳 / 边条件 / NL 自动生成（能力详解）

三项能力叠加,让"过去30天有过购买的用户"这类自然语言一句话即可落到正确 SQL。

### 6.1 链式多跳（引擎）
- `objects.py` 的 `_build_relations` **递归**展开关系树:每个关系锚定在**父对象别名**上,
  嵌套 `relations` 以当前 target 为下一跳锚点 → 支持 `user→account→product`。
- 跳数守卫按**整棵树总跳数**(`_count_hops`)算,> 3 拒绝。
- 请求模型 `ObjectRelation` 自引用(`relations: list["ObjectRelation"]`),否则 Pydantic 会
  在 `/objects/search`、`cdp_search` 入口静默吃掉嵌套跳。

### 6.2 边条件 edge_conditions（引擎 + schema）
- 作用在**关系行**(`object_relations` 别名 `r{i}`)上,而非目标对象。
- 字段白名单:`create_time`(关系发生时间)与 `properties.<key>`(经 `JSON_EXTRACT`,key 做
  alnum/下划线校验防注入)。其它字段直接报错。
- 操作符:eq/ne/gt/ge/lt/le/in/not_in/between/like。
- DSL 形态:`{"rel_type":"purchased","object":"product",
  "edge_conditions":[{"field":"create_time","op":"ge","value":"2026-05-14"}]}`。
- ⚠️ `create_time` 是 DATETIME:`between` 上界写日期会被当成当天 00:00:00 而漏掉当天,
  做"最近 N 天"优先用 `ge 起始日`。

### 6.3 NL 自动生成（agent）
- `agent.py` 规则路径 `_event_relations`:正则识别「(最近/过去/近) N 天/周/月」+「购买/访问」,
  生成链式关系并把时间窗写成 `create_time ge (今天-N天)`。
  - 相对时间在**服务端时钟**算(`datetime.now()`),规避 LLM 猜日期出错;`周→7`、`月→30` 折算。
  - 购买路径自动补 `user→owns→account→purchased→product`;访问路径 `user→visited→store`。
- LLM 兜底路径的 prompt 也已教会 edge_conditions / 链式多跳,并注入当天日期。
- `dsl.echo` 递归描述链式关系与边条件,摘要如
  「筛选用户且 其拥有的账户满足(其购买了的商品满足(发生时间 不小于 2026-05-14))」。

### 6.4 回归测试
- `tests/test_multi_object.py::TestChainedMultiHop`、`TestEdgeConditions`
- `tests/test_agent_nl.py::TestEventEdgeConditions`
- 跑法:`no_proxy='*' pytest tests/test_multi_object.py tests/test_agent_nl.py tests/test_dsl_engine.py -q`
  (`no_proxy` 绕开本机代理对 localhost 的拦截)。
