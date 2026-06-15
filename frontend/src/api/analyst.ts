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
