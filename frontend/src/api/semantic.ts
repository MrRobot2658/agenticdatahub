// 语义层 API —— 关系跨链 / 实体上下文 / 指标解释。复用 client.ts 的 axios 实例（baseURL /api）。
import { http } from "./client";

export interface ChainNode {
  key: string; object: string; id: string; label: string; hop: number;
  knowledge: { id: string; name: string; kind: string; in_context: boolean }[];
  knowledge_count: number;
}
export interface ChainEdge { src: string; dst: string; rel_type: string; direction?: string }
export interface RelationChain {
  start: string; max_hops: number; node_count: number; edge_count: number;
  knowledge_total: number; nodes: ChainNode[]; edges: ChainEdge[];
}

export async function getChain(
  tenant: number, object: string, id: string, maxHops = 3,
): Promise<RelationChain> {
  const { data } = await http.get(`/semantic/chain`, {
    params: { tenant_id: tenant, object, id, max_hops: maxHops },
  });
  return data;
}
