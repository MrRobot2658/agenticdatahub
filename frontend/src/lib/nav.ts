import {
  LayoutGrid, Plug, Users, Megaphone, ShieldCheck, Lock, Activity, Settings,
  Upload, Download, Database, FunctionSquare, RefreshCw,
  UserSearch, Fingerprint, Tag, FileCode2, Sparkles, Cloud,
  Boxes, Route, Send,
  FileCheck2, AlertTriangle, Wand2,
  EyeOff, BadgeCheck, Trash2,
  Gauge, BellRing, ScrollText,
  Building2, KeyRound, History, ShoppingCart, Package, Store,
  GitBranch, GitMerge, Library, Blocks,
  type LucideIcon,
} from "lucide-react";

// Segment 信息架构（中文主 + 英文术语）。后端能力 + Mock 占位映射到 Segment 顶层分区。
export interface NavChild {
  label: string; term?: string; to: string; icon: LucideIcon;
}
export interface NavSection {
  label: string; term: string; to: string; icon: LucideIcon; children?: NavChild[];
}

export const HOME: NavChild = { label: "概览", term: "Overview", to: "/", icon: LayoutGrid };

// 主分区
export const SECTIONS: NavSection[] = [
  {
    label: "连接", term: "Connections", to: "/connections", icon: Plug,
    children: [
      { label: "数据源", term: "Sources", to: "/connections", icon: Upload },
      { label: "可视化编排", term: "Pipelines", to: "/connections/flow", icon: Route },
      { label: "目的地", term: "Destinations", to: "/connections/destinations", icon: Download },
      { label: "Reverse ETL", term: "Reverse ETL", to: "/connections/reverse-etl", icon: RefreshCw },
      { label: "管道", term: "Pipelines", to: "/connections/pipelines", icon: Route },
      { label: "数据仓库", term: "Warehouses", to: "/connections/warehouses", icon: Database },
      { label: "Functions", term: "Functions", to: "/connections/functions", icon: FunctionSquare },
    ],
  },
  {
    label: "用户", term: "Users", to: "/unify", icon: Users,
    children: [
      { label: "用户档案", term: "Profiles", to: "/unify", icon: UserSearch },
      { label: "身份解析", term: "Identity Resolution", to: "/unify/identity", icon: Fingerprint },
      { label: "计算特征", term: "Computed Traits", to: "/unify/traits", icon: Tag },
      { label: "群组", term: "Groups", to: "/unify/groups", icon: Boxes },
      { label: "SQL 特征", term: "SQL Traits", to: "/unify/sql-traits", icon: FileCode2 },
      { label: "预测", term: "Predictions", to: "/unify/predictions", icon: Sparkles },
      { label: "档案同步", term: "Profiles Sync", to: "/unify/sync", icon: Cloud },
    ],
  },
  {
    label: "对象", term: "Objects", to: "/objects", icon: Boxes,
    children: [
      { label: "对象模型", term: "Data Model", to: "/objects/model", icon: GitBranch },
      { label: "门店", term: "Stores", to: "/objects/store", icon: Store },
      { label: "产品", term: "Products", to: "/objects/product", icon: Package },
      { label: "订单", term: "Orders", to: "/objects/order", icon: ShoppingCart },
    ],
  },
  {
    label: "客户", term: "Accounts", to: "/accounts", icon: Building2,
    children: [
      { label: "客户列表", term: "Accounts", to: "/accounts", icon: Building2 },
      { label: "合并日志", term: "Merge Log", to: "/accounts/-/merge-log", icon: GitMerge },
    ],
  },
  {
    label: "知识库", term: "Knowledge", to: "/knowledge", icon: Library,
  },
  {
    label: "应用", term: "Apps", to: "/apps", icon: Blocks,
  },
  {
    label: "触达", term: "Engage", to: "/engage", icon: Megaphone,
    children: [
      { label: "受众", term: "Audiences", to: "/engage", icon: Boxes },
      { label: "旅程", term: "Journeys", to: "/engage/journeys", icon: Route },
      { label: "群发", term: "Broadcasts", to: "/engage/broadcasts", icon: Send },
    ],
  },
  {
    label: "协议", term: "Protocols", to: "/protocols", icon: ShieldCheck,
    children: [
      { label: "埋点计划", term: "Tracking Plans", to: "/protocols", icon: FileCheck2 },
      { label: "违规", term: "Violations", to: "/protocols/violations", icon: AlertTriangle },
      { label: "转换", term: "Transformations", to: "/protocols/transformations", icon: Wand2 },
    ],
  },
  {
    label: "隐私", term: "Privacy", to: "/privacy", icon: Lock,
    children: [
      { label: "数据管控", term: "Data Controls", to: "/privacy", icon: EyeOff },
      { label: "同意管理", term: "Consent", to: "/privacy/consent", icon: BadgeCheck },
      { label: "删除与抑制", term: "Deletion & Suppression", to: "/privacy/deletion", icon: Trash2 },
    ],
  },
  {
    label: "监控", term: "Monitor", to: "/monitor", icon: Activity,
    children: [
      { label: "投递概览", term: "Delivery", to: "/monitor", icon: Gauge },
      { label: "告警", term: "Alerts", to: "/monitor/alerts", icon: BellRing },
      { label: "事件日志", term: "Event Delivery", to: "/monitor/logs", icon: ScrollText },
    ],
  },
];

// 底部分区（设置）
export const FOOTER_SECTION: NavSection = {
  label: "设置", term: "Settings", to: "/settings", icon: Settings,
  children: [
    { label: "通用", term: "General", to: "/settings", icon: Building2 },
    { label: "权限管理", term: "Access Management", to: "/settings/access", icon: Users },
    { label: "API 令牌", term: "API Tokens", to: "/settings/tokens", icon: KeyRound },
    { label: "审计日志", term: "Audit Trail", to: "/settings/audit", icon: History },
    { label: "租户管理", term: "Tenant Management", to: "/settings/tenants", icon: Building2 },
  ],
};

// Unify 下关联对象（非主导航，详情页/卡片用）
export const LINKED_ICONS = { ShoppingCart, Package, Store, Building2 };
