// 前端 Mock 数据层 —— 仿 Segment 的各功能页演示数据（未接后端，纯展示）。
// 真实数据走 SQL Engine 的页面：Sources(ETL) / Profiles / Audiences / Computed Traits。

export const functions = [
  { name: "Shopify 订单清洗", type: "Source Function", lang: "JavaScript", status: "已部署", runs7d: 12840, errors: 3 },
  { name: "脱敏 PII", type: "Destination Function", lang: "JavaScript", status: "已部署", runs7d: 9210, errors: 0 },
  { name: "汇率换算", type: "Destination Function", lang: "JavaScript", status: "草稿", runs7d: 0, errors: 0 },
];

export const reverseEtl = [
  { name: "Doris 宽表 → 飞书", source: "doris_user_wide", schedule: "每 15 分钟", records: 51, status: "运行中" },
  { name: "高价值客户 → 广告平台", source: "object_account", schedule: "每天 02:00", records: 2, status: "运行中" },
  { name: "退单用户 → 短信", source: "object_order", schedule: "手动", records: 0, status: "已暂停" },
];

export const warehouses = [
  { name: "Doris OLAP（生产）", type: "Apache Doris", region: "cn-east", lastSync: "3 分钟前", status: "健康" },
  { name: "MySQL 业务库", type: "MySQL 8", region: "cn-east", lastSync: "1 分钟前", status: "健康" },
  { name: "Hive 离线（路线图）", type: "Hive", region: "—", lastSync: "—", status: "未连接" },
];

// 单个用户档案样例（Profile 详情）
export const profileSample = {
  oneId: "100001",
  name: "张敏",
  traits: { phone: "138****8001", city: "上海", channel_count: 3, lifetime_value: 4820, tags: ["近30天购买", "高价值", "App活跃"] },
  identifiers: [
    { type: "one_id", value: "100001" },
    { type: "wechat_openid", value: "wx_offline_ee8e33d3" },
    { type: "wechat_unionid", value: "union_abc123" },
    { type: "phone", value: "13800138001" },
    { type: "email", value: "min.zhang@example.com" },
  ],
  events: [
    { time: "今天 10:22", title: "Order Completed", desc: "订单 #SO-20453 · ¥399", tone: "green" as const },
    { time: "今天 09:50", title: "Product Viewed", desc: "无线耳机", tone: "green" as const },
    { time: "昨天 21:14", title: "App Opened", desc: "iOS · v3.2.1", tone: "green" as const },
    { time: "06-11", title: "Identify", desc: "merge: wechat_openid → one_id", tone: "amber" as const },
    { time: "06-10", title: "Form Submitted", desc: "门店预约 · 上海中山公园店", tone: "green" as const },
  ],
};

export const profilesList = [
  { one_id: "100001", name: "张敏", identifiers: 5, city: "上海", ltv: 4820, last_seen: "今天" },
  { one_id: "100002", name: "李强", identifiers: 3, city: "北京", ltv: 1290, last_seen: "昨天" },
  { one_id: "100003", name: "王芳", identifiers: 4, city: "广州", ltv: 7650, last_seen: "今天" },
  { one_id: "100004", name: "陈伟", identifiers: 2, city: "深圳", ltv: 320, last_seen: "3 天前" },
];

export const identityRules = [
  { identifier: "one_id", limit: "—", isUnique: true, note: "主标识，发号器生成" },
  { identifier: "wechat_unionid", limit: "5 / profile", isUnique: true, note: "跨小程序/公众号唯一" },
  { identifier: "wechat_openid", limit: "10 / profile", isUnique: false, note: "单应用维度" },
  { identifier: "phone", limit: "5 / profile", isUnique: true, note: "强标识，触发 merge" },
  { identifier: "email", limit: "5 / profile", isUnique: false, note: "弱标识" },
  { identifier: "anonymous_id", limit: "无限", isUnique: false, note: "设备/会话级" },
];

export const sqlTraits = [
  { name: "近90天客单价", warehouse: "Doris OLAP", schedule: "每天 03:00", lastRun: "今天 03:00", rows: 37 },
  { name: "退货率", warehouse: "Doris OLAP", schedule: "每天 03:00", lastRun: "今天 03:00", rows: 37 },
  { name: "门店到访频次", warehouse: "MySQL 业务库", schedule: "每 6 小时", lastRun: "2 小时前", rows: 24 },
];

export const predictions = [
  { name: "购买倾向 Purchase", target: "Order Completed", horizon: "14 天", coverage: "82%", quality: "良好" },
  { name: "流失风险 Churn", target: "30 天无活跃", horizon: "30 天", coverage: "76%", quality: "良好" },
  { name: "LTV 预测", target: "lifetime_value", horizon: "90 天", coverage: "68%", quality: "一般" },
];

export const profilesSync = [
  { warehouse: "Doris OLAP（生产）", tables: "profiles, traits, external_ids", schedule: "每 30 分钟", status: "同步中" },
  { warehouse: "MySQL 业务库", tables: "profiles", schedule: "每天 04:00", status: "已暂停" },
];

// 受众规模趋势（Audience 详情）
export const audienceSample = {
  name: "近30天购买用户",
  code: "recent_buyers_30d",
  size: 37,
  trend: [21, 24, 23, 27, 29, 31, 30, 33, 35, 34, 36, 37],
  conditions: "user · placed → order（过去 30 天）",
  connectedDestinations: ["飞书群机器人", "短信平台（路线图）"],
};

export const journeys = [
  { name: "新客 7 日转化", steps: 5, inJourney: 1240, conversion: "12.4%", status: "运行中" },
  { name: "购物车放弃挽回", steps: 3, inJourney: 386, conversion: "8.1%", status: "运行中" },
  { name: "会员生日关怀", steps: 2, inJourney: 54, conversion: "—", status: "草稿" },
];

export const broadcasts = [
  { name: "618 预热 Push", channel: "App Push", audience: "App活跃用户", sent: 18420, openRate: "21%", date: "06-10" },
  { name: "高价值客户专享短信", channel: "短信", audience: "高价值", sent: 2100, openRate: "—", date: "06-08" },
  { name: "复购召回 EDM", channel: "EDM", audience: "近30天购买用户", sent: 37, openRate: "34%", date: "06-12" },
];

export const trackingPlans = [
  { name: "电商核心埋点", events: 42, sources: 3, conformance: "96%", updated: "06-12" },
  { name: "小程序埋点", events: 18, sources: 1, conformance: "88%", updated: "06-09" },
];

export const trackingEvents = [
  { event: "Order Completed", type: "track", properties: 12, required: 8, status: "已批准" },
  { event: "Product Viewed", type: "track", properties: 7, required: 4, status: "已批准" },
  { event: "Identify", type: "identify", properties: 9, required: 3, status: "已批准" },
  { event: "Cart Updated", type: "track", properties: 5, required: 2, status: "草稿" },
];

export const violations = [
  { event: "Order Completed", issue: "amount 类型应为 number，收到 string", count: 142, source: "小程序", severity: "high" as const },
  { event: "Product Viewed", issue: "缺少必填属性 product_id", count: 56, source: "App", severity: "high" as const },
  { event: "Page Viewed", issue: "未在埋点计划中声明的属性 utm_x", count: 980, source: "Web", severity: "low" as const },
];

export const transformations = [
  { name: "重命名 amount → order_amount", scope: "Order Completed", type: "属性重命名", status: "启用" },
  { name: "丢弃 PII 字段", scope: "所有事件", type: "属性删除", status: "启用" },
  { name: "渠道值归一化", scope: "Identify", type: "值映射", status: "停用" },
];

export const piiFields = [
  { field: "phone", category: "电话", detected: "自动", action: "哈希", scope: "全部目的地" },
  { field: "email", category: "邮箱", detected: "自动", action: "哈希", scope: "全部目的地" },
  { field: "id_card", category: "身份证", detected: "自动", action: "阻断", scope: "全部目的地" },
  { field: "address", category: "地址", detected: "手动", action: "明文", scope: "仅数仓" },
];

export const consentCategories = [
  { category: "功能性 Functional", required: true, optedIn: "100%", vendors: 3 },
  { category: "分析 Analytics", required: false, optedIn: "78%", vendors: 5 },
  { category: "广告 Advertising", required: false, optedIn: "41%", vendors: 8 },
];

export const deletionRequests = [
  { id: "DR-2041", subject: "phone:13800138001", type: "删除 + 抑制", requested: "06-12", status: "处理中" },
  { id: "DR-2038", subject: "email:min.zhang@example.com", type: "仅抑制", requested: "06-11", status: "已完成" },
  { id: "DR-2035", subject: "one_id:100087", type: "删除", requested: "06-09", status: "已完成" },
];

// 监控
export const deliveryMetrics = {
  events24h: 1284032,
  successRate: 99.7,
  failed24h: 3820,
  p95LatencyMs: 142,
  series: [120, 132, 128, 140, 155, 149, 160, 172, 168, 181, 176, 190, 184, 201],
};
export const sourcesHealth = [
  { source: "CSV / 粘贴", events24h: 51, errorRate: "0%", status: "健康" },
  { source: "小程序", events24h: 842000, errorRate: "0.2%", status: "健康" },
  { source: "App", events24h: 391000, errorRate: "0.9%", status: "降级" },
  { source: "Web 表单", events24h: 51000, errorRate: "0%", status: "健康" },
];
export const alerts = [
  { name: "投递成功率 < 99%", channel: "邮件 + 飞书", scope: "App 数据源", status: "已触发", severity: "high" as const, last: "12 分钟前" },
  { name: "事件量骤降 > 50%", channel: "飞书", scope: "全部数据源", status: "正常", severity: "low" as const, last: "—" },
  { name: "违规激增", channel: "邮件", scope: "电商核心埋点", status: "正常", severity: "low" as const, last: "—" },
];
export const eventLogs = [
  { time: "10:22:14", source: "小程序", event: "Order Completed", dest: "Doris", status: "成功", code: 200 },
  { time: "10:22:13", source: "App", event: "Product Viewed", dest: "飞书", status: "成功", code: 200 },
  { time: "10:22:11", source: "App", event: "Cart Updated", dest: "广告平台", status: "重试", code: 429 },
  { time: "10:22:08", source: "Web 表单", event: "Form Submitted", dest: "Doris", status: "成功", code: 200 },
  { time: "10:22:02", source: "小程序", event: "Order Completed", dest: "短信", status: "失败", code: 500 },
];

// 设置
export const workspaceInfo = {
  name: "Acme CDP",
  slug: "acme-cdp",
  region: "cn-east（华东）",
  plan: "Business",
  created: "2026-01-08",
  tenants: [1001, 1002],
};
export const iamUsers = [
  { name: "Ag Cortez", email: "ag_cortez@toothfairy.com", role: "Workspace Owner", teams: "全部", status: "活跃" },
  { name: "数据组-小李", email: "li@acme.com", role: "Engage Editor", teams: "增长", status: "活跃" },
  { name: "合规-王", email: "wang@acme.com", role: "Privacy Admin", teams: "合规", status: "活跃" },
  { name: "外部 BI", email: "bi@partner.com", role: "Read-only", teams: "—", status: "待激活" },
];
export const roles = [
  { role: "Workspace Owner", members: 1, scope: "全部分区 · 读写 + 计费" },
  { role: "Engage Editor", members: 3, scope: "Engage / Unify · 读写" },
  { role: "Privacy Admin", members: 1, scope: "Privacy · 读写" },
  { role: "Read-only", members: 6, scope: "全部 · 只读" },
];
export const apiTokens = [
  { label: "生产 · 服务端", prefix: "sk_live_8f…a21", scopes: "读写", created: "2026-02-01", lastUsed: "2 分钟前" },
  { label: "BI 只读", prefix: "sk_ro_31…9cd", scopes: "只读", created: "2026-03-14", lastUsed: "今天" },
  { label: "CI 部署", prefix: "sk_ci_77…0ab", scopes: "部署", created: "2026-05-02", lastUsed: "昨天" },
];
export const auditTrail = [
  { time: "10:18", actor: "ag_cortez", action: "创建受众「近30天购买用户」", target: "Engage / Audiences" },
  { time: "09:54", actor: "li@acme.com", action: "编辑埋点计划「电商核心埋点」", target: "Protocols" },
  { time: "昨天 17:30", actor: "wang@acme.com", action: "批准删除请求 DR-2038", target: "Privacy" },
  { time: "昨天 14:02", actor: "system", action: "Reverse ETL 同步成功（51 行）", target: "Connections" },
];

// 源/目的地详情样例
export const sourceDetail = {
  name: "CSV / 粘贴",
  writeKey: "csv_inline_demo_key",
  events24h: 51,
  schemaEvents: ["Order Completed", "Product Viewed", "Identify"],
  recent: [
    { time: "10:22", event: "Order Completed", anonymousId: "—", status: "成功" },
    { time: "10:21", event: "Product Viewed", anonymousId: "a_8821", status: "成功" },
    { time: "10:20", event: "Identify", anonymousId: "a_8821", status: "成功" },
  ],
};
