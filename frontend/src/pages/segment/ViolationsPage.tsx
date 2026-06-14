import { useEffect, useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Spinner } from "../../components/ui";
import { StatCards, StatusPill, EmptyState } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import { listViolations, deleteViolation, type Violation } from "../../api/protocols";

export default function ViolationsPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [rows, setRows] = useState<Violation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string>("");

  function load() {
    setRows(null); setErr(null);
    listViolations(tenant, severity ? { severity } : undefined)
      .then(setRows).catch((e) => setErr(String(e)));
  }
  useEffect(load, [tenant, severity]);

  async function remove(v: Violation) {
    if (!confirm(tr(`删除违规记录「${v.event} · ${v.issue}」？`, `Delete violation "${v.event} · ${v.issue}"?`))) return;
    try { await deleteViolation(tenant, v.id); load(); }
    catch (e) { setErr(String(e)); }
  }

  const totalCount = rows?.reduce((a, v) => a + v.count, 0) ?? 0;
  const high = rows?.filter((v) => v.severity === "high").length ?? 0;

  return (
    <Layout
      title={tr("数据质量违规 Violations", "Violations")}
      subtitle={tr("上报与埋点计划不符的事件，及时发现并修复数据质量问题（来自 /protocols/violations）", "Events that don't match the tracking plan — spot and fix data quality issues early (from /protocols/violations)")}
      actions={
        <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">{tr("全部级别", "All severities")}</option>
          <option value="high">{tr("仅高危", "High only")}</option>
          <option value="low">{tr("仅低危", "Low only")}</option>
        </select>
      }
    >
      <StatCards items={[
        { label: tr("违规类型", "Violation types"), value: rows?.length ?? "—" },
        { label: tr("受影响事件次数", "Affected events"), value: totalCount.toLocaleString() },
        { label: tr("高危", "High severity"), value: high },
      ]} />

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {rows && rows.length === 0 && (
        <EmptyState
          icon={AlertTriangle}
          title={tr("暂无违规记录", "No violations")}
          desc={tr("当上报事件不符合埋点计划 schema 时，会在此处出现。", "Events that don't conform to the tracking plan schema will appear here.")}
        />
      )}

      {rows && rows.length > 0 && (
        <Card className="p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-400">
                <th className="px-4 py-3 font-semibold">{tr("事件", "Event")}</th>
                <th className="px-4 py-3 font-semibold">{tr("问题", "Issue")}</th>
                <th className="px-4 py-3 font-semibold">{tr("出现次数", "Occurrences")}</th>
                <th className="px-4 py-3 font-semibold">{tr("数据源", "Source")}</th>
                <th className="px-4 py-3 font-semibold">{tr("级别", "Severity")}</th>
                <th className="px-4 py-3 font-semibold">{tr("最近", "Last seen")}</th>
                <th className="px-4 py-3 font-semibold">{tr("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{v.event}</td>
                  <td className="px-4 py-3 text-gray-700">{v.issue}</td>
                  <td className="px-4 py-3 text-gray-700">{v.count.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-500">{v.source || "—"}</td>
                  <td className="px-4 py-3">
                    {v.severity === "high"
                      ? <StatusPill tone="red">{tr("高", "High")}</StatusPill>
                      : <StatusPill tone="gray">{tr("低", "Low")}</StatusPill>}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{v.last_seen ? String(v.last_seen).slice(0, 19).replace("T", " ") : "—"}</td>
                  <td className="px-4 py-3">
                    <button className="text-gray-400 hover:text-red-600" onClick={() => remove(v)} title={tr("删除", "Delete")}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Layout>
  );
}
