import { http } from "./client";

export interface InstalledApp {
  app_key: string;
  status: string; // active / inactive
  config?: any;
  updated_at?: string | null;
}

export async function listInstalledApps(tenant: number): Promise<InstalledApp[]> {
  const { data } = await http.get(`/apps`, { params: { tenant_id: tenant } });
  return data.installed || [];
}

export async function setApp(tenant: number, appKey: string, status: "active" | "inactive"): Promise<InstalledApp> {
  const { data } = await http.post(`/apps/${appKey}`, null, { params: { tenant_id: tenant, status } });
  return data;
}

export async function removeApp(tenant: number, appKey: string): Promise<void> {
  await http.delete(`/apps/${appKey}`, { params: { tenant_id: tenant } });
}
