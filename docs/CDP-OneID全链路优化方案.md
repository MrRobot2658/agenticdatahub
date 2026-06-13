# CDP OneID 全链路优化方案 V3.0-03

> 简洁版 | 2026年6月 | 合并：CDP 专项优化 + CDP Agent

## 核心目标

1. **OneID 实时化**：Flink + Redis，P50 < 5ms
2. **多租户水平扩展**：Kafka / Flink / Redis / Doris 分级伸缩
3. **多对象筛选**（长期）：跨对象圈选，差异化于火山 VeCDP
4. **NL Segment**：自然语言 → 候选规则 → 引擎校验 → 人工确认

## 技术组件

| 组件 | 角色 |
|------|------|
| Kafka | 多租户事件总线 |
| Flink | 实时 OneID / 画像 / 宽表 |
| Redis | OneID 热层 |
| Doris | OLAP 画像 / 圈选 |
| StreamPark | Flink 实时 Job 管控 |
| **DolphinScheduler** | **离线 / 批任务调度** |
| SQL Engine | 模板化 OLAP 查询 |
| CDP Agent | NL 圈人编排层 |

## 第一部分：短期 — 水平扩展

详见 PDF 图 1–3。关键 Before/After：Java IDM + CDC → Kafka + Flink 三 Job。

### 水平扩展问题与对策

| 组件 | 典型问题 | 对策 |
|------|---------|------|
| Redis | 热 Key、merge 后缓存不一致、穿透 | 大租户独立 Cluster；merge 主动失效；命中率监控 |
| Kafka | 跨分区乱序、rebalance 重复消费 | merge 事件 key=one_id；幂等写入 |
| Flink | 背压、热点倾斜、checkpoint 超时 | Async Sink；加盐；State TTL |
| Doris | 全表扫、分桶倾斜、读写抢 IO | 分区裁剪；重估 BUCKETS；读写分离 |
| DolphinScheduler | 批流争抢、级联失败 | 限流配额；分时调度；重试告警 |

## 第二部分：长期 — 多对象筛选

User 单实体 → User + Lead + Account + Product + Store + object_relations。

## 第三部分：NL Segment

cdp-agent → Filter/Query Engine 校验 → 用户确认 → 保存规则。

| 阶段 | 能力 | 周期 |
|------|------|------|
| Phase 1 | NL 圈人 + 人数预估 + MCP | 约 2 个月 |
| Phase 2 | 跨对象 NL + 规则诊断 | 约 2 个月 |
| Phase 3 | Doris Hybrid Search | 约 2 个月 |

---

信息来源：CDP 专项优化 by Bob + CDP Agent by 国荣

完整架构图见 [`CDP优化方案V3.0-03.pdf`](./CDP优化方案V3.0-03.pdf)
