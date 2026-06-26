// 知识库 API —— 文件列表 + LLM 上下文策展（纳入/移出）。复用 client.ts 的 axios 实例（baseURL /api）。
import { http } from "./client";

export type KbKind = "document" | "image" | "audio" | "video" | "archive" | "other";

export interface KbFile {
  id: string;
  name: string;
  folder: string;
  kind: KbKind;
  size_bytes: number;
  token_estimate: number;
  in_context: boolean;
  description?: string | null;
}

export async function listKbFiles(tenantId: number): Promise<KbFile[]> {
  const { data } = await http.get(`/kb/files`, { params: { tenant_id: tenantId } });
  return (data.files || []).map((f: any) => ({ ...f, in_context: !!f.in_context }));
}

export async function setKbContext(tenantId: number, fid: string, inContext: boolean): Promise<void> {
  await http.post(`/kb/files/${fid}/context`, { tenant_id: tenantId, in_context: inContext });
}

export interface KbLink { link_id: number; object_type: string; object_id: string | null }
export interface KbFileDetail extends KbFile {
  mime_type?: string | null;
  storage_path?: string | null;
  created_at?: string | null;
  links?: KbLink[];
}

export async function getKbFile(tenantId: number, fid: string): Promise<KbFileDetail> {
  const { data } = await http.get(`/kb/files/${fid}`, { params: { tenant_id: tenantId } });
  return { ...data, in_context: !!data.in_context } as KbFileDetail;
}

export function kbDownloadUrl(tenantId: number, fid: string): string {
  return `/api/kb/files/${fid}/download?tenant_id=${tenantId}`;
}

export async function uploadKbFile(tenantId: number, file: File, folder = "/上传"): Promise<void> {
  const fd = new FormData();
  fd.append("tenant_id", String(tenantId));
  fd.append("folder", folder || "/上传");
  fd.append("file", file);
  await http.post(`/kb/files`, fd);
}
