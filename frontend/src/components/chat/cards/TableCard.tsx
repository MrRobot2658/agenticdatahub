import { useEffect, useState } from "react";
import { Table2 } from "lucide-react";
import { searchObjects, draftSegment } from "../../../api/client";
import { useTenant } from "../../../context/TenantContext";
import { byKey } from "../../../lib/objects";
import type { SearchResult } from "../../../api/types";
import CardShell from "./CardShell";

// 记录表格内联卡片：可选 query（NL→条件，经 draftSegment）后 searchObjects，紧凑展示前若干行。
export default function TableCard({ object, query }: { object: string; query?: string }) {
  const { tenant } = useTenant();
  const [res, setRes] = useState<SearchResult | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [obj, setObj] = useState(object);

  useEffect(() => {
    setRes(undefined); setErr(null); setObj(object);
    (async () => {
      try {
        let conditions: any[] | undefined;
        let relations: any[] | undefined;
        let target = object;
        if (query && query.trim()) {
          const d = await draftSegment(tenant, query);
          if (d.rule) {
            target = d.rule.object || object;
            conditions = d.rule.conditions;
            relations = d.rule.relations;
          }
        }
        setObj(target);
        const r = await searchObjects({ tenant_id: tenant, object: target, conditions, relations, limit: 20 });
        setRes(r);
      } catch (e: any) {
        setErr(e?.response?.data?.detail || String(e));
      }
    })();
  }, [object, query, tenant]);

  const rows = res?.data ?? [];
  const cfg = byKey(obj);
  const cols = (cfg?.columns && cfg.columns.length ? cfg.columns : Object.keys(rows[0] ?? {}).filter((k) => k !== "properties")).slice(0, 5);

  return (
    <CardShell
      icon={<Table2 className="h-4 w-4" />}
      title={`${cfg?.label ?? obj} · 记录`}
      subtitle={query || undefined}
      loading={res === undefined && !err}
      error={err}
    >
      {res && (rows.length === 0 ? (
        <div className="text-[13px] text-gray-400">无匹配记录</div>
      ) : (
        <div className="space-y-1.5">
          <div className="text-[11px] text-gray-400">共 {res.row_count ?? rows.length} 条（展示前 {Math.min(rows.length, 20)} 条）</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-400">
                  {cols.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1 font-medium">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((r, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    {cols.map((c) => (
                      <td key={c} className="max-w-[140px] truncate px-2 py-1 text-gray-700" title={fmt(r[c])}>{fmt(r[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </CardShell>
  );
}

function fmt(v: any): string {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.join("、");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
