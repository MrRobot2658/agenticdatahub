// 00-platform 模块 API —— 租户管理 / 每租户配置 / 配置审计。
// 独立文件，避免与 client.ts 并发冲突；复用同一 axios 实例（baseURL /api）。
import { http } from "./client";

// ── 数据底座统计（右侧概览）────────────────────────────────────────────────
export interface InfraStats {
  mysql_tables: number;
  mysql_table_names: string[];
  doris_tables: number;
  doris_table_names: string[];
  kafka_topics: number | null;        // Kafka 不可达时为 null
  kafka_topic_names: string[] | null;
  flink_jobs: number | null;          // id-mapping(模拟 Flink) 不可达时为 null
  flink_streams: string[] | null;
}
export async function getInfraStats(): Promise<InfraStats> {
  const { data } = await http.get(`/platform/infra-stats`);
  return data as InfraStats;
}

// ── 配置域常量（与后端 platform_api.CONFIG_DOMAINS 保持一致）───────────────
export const CONFIG_DOMAINS = [
  "基础",
  "数据通道",
  "容量",
  "ID-Mapping",
  "存储",
  "隐私",
  "集成",
  "配额",
] as const;
export type ConfigDomain = (typeof CONFIG_DOMAINS)[number];

// ── 类型 ────────────────────────────────────────────────────────────────
export interface TenantRow {
  tenant_id: number;
  tenant_name: string;
  tier: string;
  status: string;
  scale_tier: string;
  contact_email: string | null;
  created_at: string;
  updated_at: string;
  events_count_24h: number;
}

export interface TenantDetail {
  tenant_id: number;
  tenant_name: string;
  tier: string;
  status: string;
  scale_tier: string;
  contact_email: string | null;
  description: string | null;
  kafka_topic: string | null;
  created_at: string;
  updated_at: string;
  events_24h: number;
  config_summary: Record<string, number>;
}

export interface TenantListResult {
  tenants: TenantRow[];
  total: number;
}

export type TenantConfig = {
  tenant_id: number;
} & Partial<Record<ConfigDomain, Record<string, any>>>;

export interface TenantCreateBody {
  tenant_name: string;
  tier?: string;
  scale_tier?: string;
  contact_email?: string | null;
  description?: string | null;
  actor?: string | null;
}

export interface TenantUpdateBody {
  tenant_name?: string;
  tier?: string;
  scale_tier?: string;
  contact_email?: string | null;
  description?: string | null;
  actor?: string | null;
}

export interface ConfigUpdateBody {
  domain: ConfigDomain;
  updates: Record<string, any>;
  reason?: string | null;
  actor?: string | null;
}

export interface AuditRow {
  audit_id: number;
  tenant_id: number;
  actor: string;
  action: string;
  target: string;
  old_value: any;
  new_value: any;
  reason: string | null;
  created_at: string;
}

export interface AuditListResult {
  audits: AuditRow[];
  total: number;
}

// ── API 函数 ──────────────────────────────────────────────────────────────
export interface ListTenantsParams {
  search?: string;
  tier?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listTenants(params: ListTenantsParams = {}): Promise<TenantListResult> {
  const { data } = await http.get(`/platform/tenants`, { params });
  return data;
}

export async function getTenant(tenantId: number): Promise<TenantDetail> {
  const { data } = await http.get(`/platform/tenants/${tenantId}`);
  return data;
}

export async function createTenant(body: TenantCreateBody): Promise<{
  tenant_id: number; tenant_name: string; status: string; created_at: string;
}> {
  const { data } = await http.post(`/platform/tenants`, body);
  return data;
}

export async function updateTenant(
  tenantId: number,
  body: TenantUpdateBody,
): Promise<{ tenant_id: number; updated_at: string }> {
  const { data } = await http.put(`/platform/tenants/${tenantId}`, body);
  return data;
}

export async function setTenantStatus(
  tenantId: number,
  status: "active" | "suspended",
  reason?: string,
  actor?: string,
): Promise<{ tenant_id: number; status: string; updated_at: string }> {
  const { data } = await http.patch(`/platform/tenants/${tenantId}`, { status, reason, actor });
  return data;
}

export async function getTenantConfig(
  tenantId: number,
  domain?: ConfigDomain,
): Promise<TenantConfig> {
  const { data } = await http.get(`/platform/tenants/${tenantId}/config`, {
    params: domain ? { domain } : undefined,
  });
  return data;
}

export async function updateTenantConfig(
  tenantId: number,
  body: ConfigUpdateBody,
): Promise<{ tenant_id: number; domain: string; updated_keys: string[]; updated_at: string }> {
  const { data } = await http.put(`/platform/tenants/${tenantId}/config`, body);
  return data;
}

export interface ListAuditParams {
  tenant_id?: number;
  actor?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

export async function listConfigAudit(params: ListAuditParams = {}): Promise<AuditListResult> {
  const { data } = await http.get(`/platform/audit/tenant-config`, { params });
  return data;
}
