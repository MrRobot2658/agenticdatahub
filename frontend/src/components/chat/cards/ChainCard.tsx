import { useEffect, useState } from "react";
import { Share2, Paperclip } from "lucide-react";
import { getChain, type RelationChain } from "../../../api/semantic";
import { useTenant } from "../../../context/TenantContext";
import CardShell from "./CardShell";

// 关系跨链归因图：分跳(列) 布局 + SVG 连线；节点按对象类型着色，关联知识高亮。
const OBJ_COLOR: Record<string, string> = {
  account: "#6366f1", user: "#10b981", order: "#f59e0b", product: "#0ea5e9",
  store: "#8b5cf6", lead: "#ec4899", segment: "#f43f5e",
};
const OBJ_CN: Record<string, string> = {
  account: "客户", user: "用户", order: "订单", product: "产品",
  store: "门店", lead: "线索", segment: "受众",
};

const NW = 130, NH = 38, COLW = 168, VGAP = 12, PADX = 12, PADY = 14;

export default function ChainCard({ object, id, maxHops }: { object: string; id: string; maxHops?: number }) {
  const { tenant } = useTenant();
  const [chain, setChain] = useState<RelationChain | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setChain(undefined); setErr(null);
    getChain(tenant, object, id, maxHops || 3)
      .then(setChain).catch((e) => setErr(e?.response?.data?.detail || String(e)));
  }, [object, id, maxHops, tenant]);

  // 按 hop 分列布局，记录每个节点坐标
  const pos: Record<string, { x: number; y: number; n: any }> = {};
  let width = 0, height = 0;
  if (chain) {
    const byHop: Record<number, any[]> = {};
    chain.nodes.forEach((n) => { (byHop[n.hop] ||= []).push(n); });
    const hops = Object.keys(byHop).map(Number).sort((a, b) => a - b);
    hops.forEach((h) => {
      byHop[h].forEach((n, i) => {
        pos[n.key] = { x: PADX + h * COLW, y: PADY + i * (NH + VGAP), n };
      });
      height = Math.max(height, PADY + byHop[h].length * (NH + VGAP));
    });
    width = PADX + (Math.max(...hops) + 1) * COLW;
  }

  return (
    <CardShell
      icon={<Share2 className="h-4 w-4" />}
      title="关系归因链"
      subtitle={chain ? `${chain.node_count} 节点 · ${chain.edge_count} 边 · ${chain.knowledge_total} 关联知识 · ${chain.max_hops} 跳` : `${object}:${id}`}
      loading={chain === undefined && !err}
      error={err}
    >
      {chain && (chain.nodes.length === 0 ? (
        <div className="text-[13px] text-gray-400">无关联</div>
      ) : (
        <div className="overflow-x-auto">
          <svg width={width} height={height + PADY} className="block">
            {/* 边 */}
            {chain.edges.map((e, i) => {
              const a = pos[e.src], b = pos[e.dst];
              if (!a || !b) return null;
              const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2;
              const mx = (x1 + x2) / 2;
              return (
                <g key={i}>
                  <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                    fill="none" stroke="#cbd5e1" strokeWidth={1.3} />
                  <text x={mx} y={(y1 + y2) / 2 - 3} fontSize={9} fill="#94a3b8" textAnchor="middle">{e.rel_type}</text>
                </g>
              );
            })}
            {/* 节点 */}
            {Object.values(pos).map(({ x, y, n }) => {
              const c = OBJ_COLOR[n.object] || "#64748b";
              const hasKb = n.knowledge_count > 0;
              return (
                <g key={n.key}>
                  <rect x={x} y={y} width={NW} height={NH} rx={9}
                    fill="#fff" stroke={c} strokeWidth={1.6} />
                  <rect x={x} y={y} width={4} height={NH} rx={2} fill={c} />
                  <text x={x + 11} y={y + 15} fontSize={9} fill={c} fontWeight={600}>{OBJ_CN[n.object] || n.object}</text>
                  <text x={x + 11} y={y + 29} fontSize={11} fill="#1e293b">
                    {String(n.label).length > 11 ? String(n.label).slice(0, 11) + "…" : n.label}
                  </text>
                  {hasKb && (
                    <g>
                      <circle cx={x + NW - 11} cy={y + 12} r={8} fill="#eef2ff" stroke="#6366f1" strokeWidth={1} />
                      <text x={x + NW - 11} y={y + 15} fontSize={9} fill="#6366f1" textAnchor="middle">{n.knowledge_count}</text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          {/* 关联知识清单 */}
          {chain.knowledge_total > 0 && (
            <div className="mt-2 border-t border-gray-100 pt-2 text-[11px] text-gray-500">
              {chain.nodes.filter((n) => n.knowledge_count > 0).map((n) => (
                <div key={n.key} className="flex items-center gap-1.5 py-0.5">
                  <Paperclip className="h-3 w-3 text-brand-500" />
                  <span className="text-gray-700">{n.label}</span>
                  <span className="text-gray-400">·</span>
                  <span>{n.knowledge.map((k) => k.name).join("、")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </CardShell>
  );
}
