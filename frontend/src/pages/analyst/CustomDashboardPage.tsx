import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trash2, LayoutDashboard, Pencil, Check, Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Button, Spinner, TextField } from "../../components/ui";
import { EmptyState } from "../../components/segment/kit";
import AnalystChart from "../../components/analyst/AnalystChart";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import {
  getDashboard, deleteDashboard, updateDashboard, listChartSources,
  type Dashboard, type ChartSource,
} from "../../api/analyst";

// 自定义看板详情：渲染可下钻图表 + 二次编辑（改标题 / 加减图表）。
export default function CustomDashboardPage() {
  const { id = "" } = useParams();
  const { tenant } = useTenant();
  const { tr } = useLang();
  const navigate = useNavigate();

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [sources, setSources] = useState<ChartSource[]>([]);
  const [addSrc, setAddSrc] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDashboard(null); setErr(null); setEditing(false);
    getDashboard(tenant, id)
      .then((d) => { setDashboard(d); setTitleDraft(d.title); })
      .catch((e) => setErr(e?.response?.data?.detail || e.message || String(e)));
    listChartSources().then((r) => setSources(r.sources)).catch(() => {});
  }, [tenant, id]);

  async function apply(body: { title?: string; sources?: string[] }) {
    setBusy(true); setErr(null);
    try {
      const d = await updateDashboard(tenant, id, body);
      setDashboard(d); setTitleDraft(d.title);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message || tr("保存失败", "Failed to save"));
    } finally { setBusy(false); }
  }

  async function onDelete() {
    if (!dashboard) return;
    if (!window.confirm(tr(`删除看板「${dashboard.title}」？`, `Delete dashboard "${dashboard.title}"?`))) return;
    try { await deleteDashboard(tenant, id); navigate("/analyst"); }
    catch (e: any) { setErr(e?.response?.data?.detail || e.message || tr("删除失败", "Failed to delete")); }
  }

  const charts = dashboard?.charts || [];
  const usedSources = new Set((dashboard?.sources) || []);
  const addable = sources.filter((s) => !usedSources.has(s.key));

  function removeChart(source: string) {
    const next = (dashboard?.sources || []).filter((s) => s !== source);
    if (next.length === 0) { setErr(tr("看板至少保留一个图表", "Keep at least one chart")); return; }
    apply({ sources: next });
  }
  function addChart() {
    if (!addSrc) return;
    apply({ sources: [...(dashboard?.sources || []), addSrc] }).then(() => setAddSrc(""));
  }

  return (
    <Layout
      title={dashboard?.title || tr("看板", "Dashboard")}
      subtitle={tr("自定义看板 · 可二次编辑", "Custom dashboard · editable")}
      actions={
        <div className="flex items-center gap-2">
          <Link to="/analyst">
            <Button variant="outline"><ArrowLeft className="h-4 w-4" /> {tr("返回列表", "Back")}</Button>
          </Link>
          {editing ? (
            <Button variant="outline" onClick={() => setEditing(false)}>
              <Check className="h-4 w-4" /> {tr("完成", "Done")}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setEditing(true)} disabled={!dashboard}>
              <Pencil className="h-4 w-4" /> {tr("编辑", "Edit")}
            </Button>
          )}
          <Button variant="outline" onClick={onDelete} disabled={!dashboard}>
            <Trash2 className="h-4 w-4" /> {tr("删除看板", "Delete")}
          </Button>
        </div>
      }
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      {!dashboard && !err && (
        <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>
      )}

      {/* 编辑工具条：改标题 + 加图表 */}
      {dashboard && editing && (
        <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[220px] flex-1">
            <TextField label={tr("看板标题", "Title")} value={titleDraft} onChange={setTitleDraft} />
          </div>
          <Button onClick={() => apply({ title: titleDraft.trim() })} disabled={busy || !titleDraft.trim()}>
            {busy ? <Spinner /> : <Check className="h-4 w-4" />} {tr("保存标题", "Save Title")}
          </Button>
          <div className="h-8 w-px bg-gray-200" />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{tr("添加图表", "Add Chart")}</span>
            <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={addSrc} onChange={(e) => setAddSrc(e.target.value)}>
              <option value="">{tr("选择数据源…", "Select source…")}</option>
              {addable.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
            </select>
          </label>
          <Button onClick={addChart} disabled={busy || !addSrc}>
            <Plus className="h-4 w-4" /> {tr("添加", "Add")}
          </Button>
        </Card>
      )}

      {dashboard && charts.length === 0 && !editing && (
        <EmptyState icon={LayoutDashboard}
          title={tr("该看板还没有图表", "No charts in this dashboard")}
          desc={tr("点右上角「编辑」添加图表，或回列表重建。", "Click Edit to add charts, or recreate from the list.")} />
      )}

      {dashboard && charts.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {charts.map((c) => (
            <AnalystChart
              key={c.source}
              tenant={tenant}
              title={c.title}
              type={c.type}
              source={c.source}
              data={c.data}
              onDelete={editing ? () => removeChart(c.source) : undefined}
            />
          ))}
        </div>
      )}
    </Layout>
  );
}
