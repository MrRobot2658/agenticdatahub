// 渠道身份类型 → 中文展示名 / 英文名 / 分组。前端画像、行为时间线统一用此映射，
// 与后端 id-mapping CHANNEL_TYPES、doris_user_wide 列保持一致。
export interface ChannelMeta {
  key: string;        // 渠道身份列 / channel_type
  zh: string;         // 中文展示名
  en: string;         // 英文展示名
  group: string;      // 渠道大类（用于分组/图例）
}

export const CHANNELS: ChannelMeta[] = [
  { key: "wechat_openid", zh: "微信(小程序/H5)", en: "WeChat OpenID", group: "微信生态" },
  { key: "wechat_unionid", zh: "微信 UnionID", en: "WeChat UnionID", group: "微信生态" },
  { key: "wechat_mp_openid", zh: "微信公众号", en: "Official Account", group: "微信生态" },
  { key: "wechat_channels_id", zh: "微信视频号", en: "WeChat Channels", group: "微信生态" },
  { key: "wework_extid", zh: "企业微信", en: "WeCom", group: "微信生态" },
  { key: "web_visitor_id", zh: "官网埋点", en: "Website", group: "自有渠道" },
  { key: "form_id", zh: "表单留资", en: "Form Lead", group: "自有渠道" },
  { key: "device", zh: "App 设备", en: "App Device", group: "自有渠道" },
  { key: "xiaohongshu_id", zh: "小红书", en: "Xiaohongshu", group: "社媒渠道" },
  { key: "douyin_id", zh: "抖音", en: "Douyin", group: "社媒渠道" },
  { key: "phone", zh: "手机号", en: "Phone", group: "联系方式" },
  { key: "email", zh: "邮箱", en: "Email", group: "联系方式" },
];

const BY_KEY: Record<string, ChannelMeta> = Object.fromEntries(CHANNELS.map((c) => [c.key, c]));

// 渠道身份列（doris_user_wide 上的标识列，不含 phone/email/one_id 这类基础字段以外的展示控制由调用方决定）
export const CHANNEL_ID_FIELDS = CHANNELS.map((c) => c.key);

export function channelLabel(key: string, en = false): string {
  const m = BY_KEY[key];
  if (!m) return key;
  return en ? m.en : m.zh;
}

export function channelGroup(key: string): string {
  return BY_KEY[key]?.group ?? "其他";
}
