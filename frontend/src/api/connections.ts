// 01 · 连接 Connections 模块 API 客户端。
// 独立文件，避免并发改 client.ts；复用其 axios 实例 http（baseURL=/api）。
// 所有端点按 tenant_id 隔离，对标 Segment Connections。
import { http } from "./client";

// ── 类型 ────────────────────────────────────────────────────────────────
export interface Source {
  source_id: string;
  source_name: string;
  source_type: string;
  write_key?: string | null; // 列表中已脱敏
  status: string;
  last_event_time?: string | null;
  event_count_24h?: number;
}

export interface SourceEvent {
  event_id: string;
  event_type: string;
  timestamp?: string | null;
  anonymousId?: string | null;
  user_id?: string | null;
  status: string;
  error_msg?: string | null;
  created_at?: string | null;
}

export interface SourceDetail extends Source {
  config?: Record<string, any>;
  schema?: Record<string, any>;
  recent_events: SourceEvent[];
}

export interface Destination {
  destination_id: string;
  destination_name: string;
  destination_type: string;
  enabled: number | boolean;
}

export interface DestinationMapping {
  source_field: string;
  target_field: string;
  source_object?: string;
  transform_logic?: Record<string, any> | null;
}

export interface DestinationDetail extends Destination {
  config?: Record<string, any>;
  status: string;
  mappings: DestinationMapping[];
}

export interface ReverseEtlJob {
  job_id: string;
  job_name: string;
  source_object: string;
  destination_id: string;
  schedule_cron: string;
  enabled: number | boolean;
  next_run_time?: string | null;
  last_status?: string | null;
}

export interface ReverseEtlRun {
  run_id: string;
  start_time?: string | null;
  duration_ms?: number | null;
  row_count?: number | null;
  status: string;
  error_msg?: string | null;
}

export interface Warehouse {
  warehouse_id: string;
  warehouse_name: string;
  warehouse_type: string;
  status: string;
  last_sync_time?: string | null;
  tables_synced?: string[] | null;
}

export interface FunctionDef {
  function_id: string;
  function_name: string;
  function_type: string;
  language: string;
  status: string;
  runs_7d: number;
  errors_7d: number;
}

export interface FunctionRun {
  run_id: string;
  status: string;
  duration_ms?: number | null;
  memory_mb?: number | null;
  error_msg?: string | null;
  created_at?: string | null;
}

export interface Pipeline {
  pipeline_id: string;
  pipeline_name: string;
  status: string;
  last_executed_time?: string | null;
  node_count?: number;
  edge_count?: number;
}

export interface PipelineDetail {
  pipeline_id: string;
  pipeline_name: string;
  status: string;
  nodes: any[];
  edges: any[];
  last_executed_time?: string | null;
  execution_count?: number;
  created_at?: string | null;
}

// ── Sources ───────────────────────────────────────────────────────────────
export async function listSources(tenant: number): Promise<Source[]> {
  const { data } = await http.get(`/connections/sources`, { params: { tenant_id: tenant } });
  return data.sources || [];
}

export async function createSource(
  tenant: number,
  body: { source_name: string; source_type: string; config?: Record<string, any>; schema?: Record<string, any> },
): Promise<{ source_id: string; write_key: string; source_name: string }> {
  const { data } = await http.post(`/connections/sources`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function getSource(tenant: number, sourceId: string): Promise<SourceDetail> {
  const { data } = await http.get(`/connections/sources/${sourceId}`, { params: { tenant_id: tenant } });
  return data;
}

export async function testSource(tenant: number, sourceId: string, config: Record<string, any> = {}) {
  const { data } = await http.post(`/connections/sources/${sourceId}/test`, { config }, { params: { tenant_id: tenant } });
  return data as { ok: boolean; sample_rows?: any[]; error?: string };
}

export async function listSourceEvents(tenant: number, sourceId: string, limit = 50): Promise<SourceEvent[]> {
  const { data } = await http.get(`/connections/sources/${sourceId}/events`, { params: { tenant_id: tenant, limit } });
  return data.events || [];
}

export async function trackEvents(
  tenant: number,
  body: { write_key: string; events: { event_type: string; data?: Record<string, any>; anonymousId?: string; userId?: string }[] },
) {
  const { data } = await http.post(`/connections/events/track`, body, { params: { tenant_id: tenant } });
  return data as { ok: boolean; queued: number };
}

// ── Destinations ────────────────────────────────────────────────────────────
export async function listDestinations(tenant: number): Promise<Destination[]> {
  const { data } = await http.get(`/connections/destinations`, { params: { tenant_id: tenant } });
  return data.destinations || [];
}

export async function createDestination(
  tenant: number,
  body: { destination_name: string; destination_type: string; config?: Record<string, any> },
): Promise<{ destination_id: string; destination_name: string }> {
  const { data } = await http.post(`/connections/destinations`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function getDestination(tenant: number, destinationId: string): Promise<DestinationDetail> {
  const { data } = await http.get(`/connections/destinations/${destinationId}`, { params: { tenant_id: tenant } });
  return data;
}

export async function testDestination(tenant: number, destinationId: string, sample_data: Record<string, any> = {}) {
  const { data } = await http.post(`/connections/destinations/${destinationId}/test`, { sample_data }, { params: { tenant_id: tenant } });
  return data as { ok: boolean; latency_ms: number; error?: string };
}

export async function saveDestinationMappings(
  tenant: number,
  destinationId: string,
  body: { source_object: string; mapping: { source_field: string; target_field: string; transform_logic?: Record<string, any> }[] },
) {
  const { data } = await http.post(`/connections/destinations/${destinationId}/mappings`, body, { params: { tenant_id: tenant } });
  return data as { ok: boolean };
}

// ── Reverse-ETL ─────────────────────────────────────────────────────────────
export async function listReverseEtlJobs(tenant: number): Promise<ReverseEtlJob[]> {
  const { data } = await http.get(`/connections/reverse-etl/jobs`, { params: { tenant_id: tenant } });
  return data.jobs || [];
}

export async function createReverseEtlJob(
  tenant: number,
  body: { job_name: string; source_object: string; destination_id: string; schedule_cron?: string; enabled?: boolean },
): Promise<{ job_id: string; job_name: string }> {
  const { data } = await http.post(`/connections/reverse-etl/jobs`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function listReverseEtlRuns(tenant: number, jobId: string, limit = 50): Promise<ReverseEtlRun[]> {
  const { data } = await http.get(`/connections/reverse-etl/jobs/${jobId}/runs`, { params: { tenant_id: tenant, limit } });
  return data.runs || [];
}

export async function runReverseEtlNow(tenant: number, jobId: string) {
  const { data } = await http.post(`/connections/reverse-etl/jobs/${jobId}/run-now`, {}, { params: { tenant_id: tenant } });
  return data as { run_id: string; status: string };
}

// ── Warehouses ──────────────────────────────────────────────────────────────
export async function listWarehouses(tenant: number): Promise<Warehouse[]> {
  const { data } = await http.get(`/connections/warehouses`, { params: { tenant_id: tenant } });
  return data.warehouses || [];
}

export async function createWarehouse(
  tenant: number,
  body: {
    warehouse_name: string; warehouse_type: string; connection_string?: string;
    username?: string; password?: string; database_name?: string; sync_frequency_seconds?: number;
  },
): Promise<{ warehouse_id: string; warehouse_name: string; status: string }> {
  const { data } = await http.post(`/connections/warehouses`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function syncWarehouse(tenant: number, warehouseId: string) {
  const { data } = await http.post(`/connections/warehouses/${warehouseId}/sync`, {}, { params: { tenant_id: tenant } });
  return data as { ok: boolean; queued_tables: string[] };
}

// ── Functions ───────────────────────────────────────────────────────────────
export async function listFunctions(tenant: number): Promise<FunctionDef[]> {
  const { data } = await http.get(`/connections/functions`, { params: { tenant_id: tenant } });
  return data.functions || [];
}

export async function createFunction(
  tenant: number,
  body: { function_name: string; function_type: string; language?: string; code?: string; entry_point?: string },
): Promise<{ function_id: string; function_name: string; status: string }> {
  const { data } = await http.post(`/connections/functions`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function deployFunction(tenant: number, functionId: string) {
  const { data } = await http.post(`/connections/functions/${functionId}/deploy`, {}, { params: { tenant_id: tenant } });
  return data as { ok: boolean; function_id: string };
}

export async function listFunctionRuns(tenant: number, functionId: string, limit = 50): Promise<FunctionRun[]> {
  const { data } = await http.get(`/connections/functions/${functionId}/runs`, { params: { tenant_id: tenant, limit } });
  return data.runs || [];
}

// ── Pipelines ───────────────────────────────────────────────────────────────
export async function listPipelines(tenant: number): Promise<Pipeline[]> {
  const { data } = await http.get(`/connections/pipelines`, { params: { tenant_id: tenant } });
  return data.pipelines || [];
}

export async function createPipeline(
  tenant: number,
  body: { pipeline_name: string; nodes?: any[]; edges?: any[]; status?: string },
): Promise<{ pipeline_id: string; pipeline_name: string }> {
  const { data } = await http.post(`/connections/pipelines`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function getPipeline(tenant: number, pipelineId: string): Promise<PipelineDetail> {
  const { data } = await http.get(`/connections/pipelines/${pipelineId}`, { params: { tenant_id: tenant } });
  return data;
}

export interface SchedulerInfo {
  reachable: boolean;
  scheduler?: string;
  metadatabase?: string;
  dag_id?: string;
  ui_url?: string;
  error?: string;
  dag_run?: { dag_run_id: string; state: string | null };
  engine?: string;
}

export async function executePipeline(tenant: number, pipelineId: string) {
  const { data } = await http.post(`/connections/pipelines/${pipelineId}/execute`, {}, { params: { tenant_id: tenant } });
  return data as { execution_id: string; status: string; estimated_duration_ms: number; scheduler?: SchedulerInfo };
}

export async function schedulerHealth(): Promise<SchedulerInfo> {
  const { data } = await http.get(`/connections/scheduler/health`);
  return data;
}
