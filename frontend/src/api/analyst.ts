import { http } from "./client";

export type ChartType = "bar" | "line" | "pie" | "area";

export interface ChartPoint { label: string; value: number; }
export interface Chart {
  id: string;
  title: string;
  type: ChartType;
  source: string;
  data: ChartPoint[];
}
export interface ChartSource { key: string; title: string; default_type: ChartType; }

export async function listCharts(tenant: number): Promise<Chart[]> {
  const { data } = await http.get(`/analyst/charts`, { params: { tenant_id: tenant } });
  return data.charts || [];
}

export async function listChartSources(): Promise<{ sources: ChartSource[]; types: ChartType[] }> {
  const { data } = await http.get(`/analyst/sources`);
  return data;
}

export async function nlChart(tenant: number, question: string): Promise<Chart> {
  const { data } = await http.post(`/analyst/charts/nl`, { question }, { params: { tenant_id: tenant } });
  return data;
}

export async function saveChart(tenant: number, body: { title: string; type: ChartType; source: string }): Promise<Chart> {
  const { data } = await http.post(`/analyst/charts`, body, { params: { tenant_id: tenant } });
  return data;
}

export async function deleteChart(tenant: number, id: string): Promise<void> {
  await http.delete(`/analyst/charts/${id}`, { params: { tenant_id: tenant } });
}

export async function getChartData(tenant: number, source: string): Promise<ChartPoint[]> {
  const { data } = await http.get(`/analyst/data`, { params: { tenant_id: tenant, source } });
  return data.data || [];
}

export interface DrilldownResult {
  columns: string[];
  rows: Record<string, string>[];
  count: number;
  label: string;
}
export async function drilldown(tenant: number, source: string, label: string): Promise<DrilldownResult> {
  const { data } = await http.get(`/analyst/drilldown`, { params: { tenant_id: tenant, source, label } });
  return data;
}

export interface Kpis {
  users: number; accounts: number; leads: number; leads_qualified: number;
  products: number; stores: number; orders: number; orders_paid: number;
  gmv: number; aov: number; lead_qualified_rate: number; order_paid_rate: number;
}
export async function getKpis(tenant: number): Promise<Kpis> {
  const { data } = await http.get(`/analyst/kpis`, { params: { tenant_id: tenant } });
  return data;
}
