// 应用市场目录（静态注册表）。连接状态存后端 installed_apps（按租户）。
import {
  Cloud, Magnet, Building2, Megaphone, Flame, Search,
  MessageSquare, Mail, MessagesSquare, Bell, Gauge, BarChart3,
  type LucideIcon,
} from "lucide-react";

export type AppCategory = "crm" | "ads" | "messaging" | "analytics";

export interface AppDef {
  key: string;
  name: string;
  category: AppCategory;
  icon: LucideIcon;
  desc: string;
}

export const APPS: AppDef[] = [
  // CRM
  { key: "salesforce", name: "Salesforce", category: "crm", icon: Cloud, desc: "全球 CRM，双向同步客户与商机" },
  { key: "hubspot", name: "HubSpot", category: "crm", icon: Magnet, desc: "营销/销售一体化 CRM" },
  { key: "neocrm", name: "销售易", category: "crm", icon: Building2, desc: "国产企业级 CRM" },
  // 广告
  { key: "gdt", name: "广点通", category: "ads", icon: Megaphone, desc: "腾讯广告，人群包回传与投放" },
  { key: "oceanengine", name: "巨量引擎", category: "ads", icon: Flame, desc: "字节跳动广告平台" },
  { key: "baiduads", name: "百度营销", category: "ads", icon: Search, desc: "百度搜索与信息流广告" },
  // 消息
  { key: "sms", name: "短信", category: "messaging", icon: MessageSquare, desc: "短信通道，营销与通知触达" },
  { key: "email", name: "邮件", category: "messaging", icon: Mail, desc: "EDM 邮件营销与事务邮件" },
  { key: "wecom", name: "企业微信", category: "messaging", icon: MessagesSquare, desc: "企业微信消息与客户联系" },
  { key: "dingtalk", name: "钉钉", category: "messaging", icon: Bell, desc: "钉钉工作通知与机器人" },
  // 分析
  { key: "sensors", name: "神策分析", category: "analytics", icon: Gauge, desc: "用户行为分析" },
  { key: "ga4", name: "Google Analytics", category: "analytics", icon: BarChart3, desc: "GA4 网站/应用分析" },
];

export const appByKey = (k: string) => APPS.find((a) => a.key === k);

const CATEGORY_ORDER: AppCategory[] = ["crm", "ads", "messaging", "analytics"];

export function appCategoryLabel(c: AppCategory, tr: (zh: string, en?: string) => string): string {
  const m: Record<AppCategory, [string, string]> = {
    crm: ["CRM 客户管理", "CRM"],
    ads: ["广告投放", "Advertising"],
    messaging: ["消息触达", "Messaging"],
    analytics: ["数据分析", "Analytics"],
  };
  return tr(...m[c]);
}

export function groupApps(): { category: AppCategory; items: AppDef[] }[] {
  return CATEGORY_ORDER
    .map((category) => ({ category, items: APPS.filter((a) => a.category === category) }))
    .filter((g) => g.items.length > 0);
}
