import { http } from "./client";

export interface KbLink {
  link_id: number;
  object_type: string;
  object_id: string | null;
}
export interface KbFile {
  id: string;
  name: string;
  folder: string;
  mime_type?: string | null;
  kind: string; // document/image/audio/video/archive/other
  size_bytes: number;
  description?: string | null;
  created_at?: string | null;
  storage_path?: string | null;
  links: KbLink[];
}

export interface ListFilesParams {
  tenant_id: number;
  folder?: string;
  object_type?: string;
  object_id?: string;
  q?: string;
  kind?: string;
}

export async function listKbFiles(params: ListFilesParams): Promise<KbFile[]> {
  const { data } = await http.get(`/kb/files`, { params });
  return data.files || [];
}

export async function listKbFolders(tenant: number): Promise<string[]> {
  const { data } = await http.get(`/kb/folders`, { params: { tenant_id: tenant } });
  return data.folders || [];
}

export async function getKbFile(tenant: number, id: string): Promise<KbFile> {
  const { data } = await http.get(`/kb/files/${id}`, { params: { tenant_id: tenant } });
  return data;
}

export async function uploadKbFile(
  tenant: number,
  file: File,
  opts: { folder?: string; description?: string; object_type?: string; object_id?: string } = {},
): Promise<{ id: string; name: string; kind: string; size_bytes: number; folder: string }> {
  const fd = new FormData();
  fd.append("tenant_id", String(tenant));
  fd.append("folder", opts.folder || "/");
  if (opts.description) fd.append("description", opts.description);
  if (opts.object_type) fd.append("object_type", opts.object_type);
  if (opts.object_id) fd.append("object_id", opts.object_id);
  fd.append("file", file);
  const { data } = await http.post(`/kb/files`, fd, { headers: { "Content-Type": "multipart/form-data" } });
  return data;
}

export async function deleteKbFile(tenant: number, id: string): Promise<void> {
  await http.delete(`/kb/files/${id}`, { params: { tenant_id: tenant } });
}

export async function addKbLink(
  tenant: number, id: string, object_type: string, object_id?: string,
): Promise<KbLink> {
  const { data } = await http.post(`/kb/files/${id}/links`, {}, { params: { tenant_id: tenant, object_type, object_id } });
  return data;
}

export async function removeKbLink(tenant: number, id: string, linkId: number): Promise<void> {
  await http.delete(`/kb/files/${id}/links/${linkId}`, { params: { tenant_id: tenant } });
}

// 下载/预览直链（带 tenant 查询参数，<img>/下载均可用）
export function kbDownloadUrl(tenant: number, id: string): string {
  return `/api/kb/files/${id}/download?tenant_id=${tenant}`;
}
