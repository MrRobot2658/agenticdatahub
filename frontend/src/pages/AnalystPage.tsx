import { useEffect, useState } from "react";
import { Plus, Trash2, Sparkles } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import Layout from "../components/layout/Layout";
import { Card, Button, Spinner, Modal, TextField } from "../components/ui";
import { StatCards } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import {
  listCharts, listChartSources, nlChart, saveChart, deleteChart,
  type Chart, type ChartType, type ChartPoint, type ChartSource,
} from "../api/analyst";

const PALETTE = ["#52bd94", "#3aa0ff", "#f5a623", "#a78bfa", "#f97316", "#ec4899", "#14b8a6", "#64748b"];
const CHART_TYPES: ChartType[] = ["bar", "line", "pie", "area"];

// 图表渲染器：根据 type 选择 recharts 组件，空数据给出占位。
function ChartView({ type, data }: { type: ChartType; data: ChartPoint[] }) {
  const { tr } = useLang();
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-gray-400">
        {tr("暂无数据", "No data")}
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      {type === "bar" ? (
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="value" fill="#52bd94" radius={[4, 4, 0, 0]} />
        </BarChart>
      ) : type === "line" ? (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="#52bd94" strokeWidth={2} dot />
        </LineChart>
      ) : type === "area" ? (
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip />
          <Area type="monotone" dataKey="value" stroke="#52bd94" fill="#cdeedd" />
        </AreaChart>
      ) : (
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label" outerRadius={90} label>
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      )}
    </ResponsiveContainer>
  );
}

export default function AnalystPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();

  const [charts, setCharts] = useState<Chart[] | null>(null);
  const [sources, setSources] = useState<ChartSource[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // 新建图表 Modal 状态
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ChartType>("bar");
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<ChartPoint[] | null>(null);
  const [gen, setGen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalErr, setModalErr] = useState<string | null>(null);

  function load() {
    setErr(null);
    listCharts(tenant).then(setCharts).catch((e) => setErr(String(e)));
  }
  useEffect(() => { setCharts(null); load(); /* eslint-disable-next-line */ }, [tenant]);
  useEffect(() => {
    listChartSources().then((r) => setSources(r.sources || [])).catch(() => {});
  }, []);

  function openModal() {
    setQ(""); setTitle(""); setType("bar");
    setSource(sources[0]?.key || "");
    setPreview(null); setModalErr(null);
    setOpen(true);
  }

  async function onGenerate() {
    if (!q.trim()) return;
    setGen(true); setModalErr(null);
    try {
      const c = await nlChart(tenant, q.trim());
      setTitle(c.title);
      setType(c.type);
      setSource(c.source);
      setPreview(c.data || []);
    } catch (e: any) {
      setModalErr(e?.response?.data?.detail || e.message || tr("生成失败", "Failed to generate"));
    } finally {
      setGen(false);
    }
  }

  async function onSave() {
    if (!title.trim() || !source) return;
    setSaving(true); setModalErr(null);
    try {
      await saveChart(tenant, { title: title.trim(), type, source });
      setOpen(false);
      load();
    } catch (e: any) {
      setModalErr(e?.response?.data?.detail || e.message || tr("保存失败", "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(c: Chart) {
    if (!c.id) return;
    if (!window.confirm(tr(`删除图表「${c.title}」？`, `Delete chart "${c.title}"?`))) return;
    try {
      await deleteChart(tenant, c.id);
      load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message || tr("删除失败", "Failed to delete"));
    }
  }

  return (
    <Layout
      title={tr("分析 Analyst", "Analyst")}
      subtitle={tr("可视化指标看板 —— 用自然语言描述即可生成图表", "Visual metrics — describe a chart in natural language to generate it")}
      actions={
        <Button onClick={openModal}><Plus className="h-4 w-4" /> {tr("新建图表", "New Chart")}</Button>
      }
    >
      {charts && (
        <StatCards items={[
          { label: tr("图表数", "Charts"), value: charts.length },
          { label: tr("数据源", "Sources"), value: sources.length },
          { label: tr("租户", "Tenant"), value: tenant },
        ]} />
      )}

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      {!charts && !err && (
        <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>
      )}

      {charts && charts.length === 0 && (
        <Card className="p-10 text-center">
          <div className="text-sm text-gray-500">{tr("还没有图表，点击右上角「新建图表」用一句话生成。", "No charts yet — use \"New Chart\" to generate one from a sentence.")}</div>
          <div className="mt-4"><Button onClick={openModal}><Plus className="h-4 w-4" /> {tr("新建图表", "New Chart")}</Button></div>
        </Card>
      )}

      {charts && charts.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {charts.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold text-gray-900">{c.title}</span>
                <button
                  onClick={() => onDelete(c)}
                  className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  title={tr("删除", "Delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <ChartView type={c.type} data={c.data} />
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} title={tr("新建图表", "New Chart")} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          {/* 自然语言生成 */}
          <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-brand-700">
              <Sparkles className="h-4 w-4" /> {tr("自然语言生成", "Generate with NL")}
            </div>
            <textarea
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              rows={2}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tr("用一句话描述图表，如：按行业看客户分布的饼图", "Describe a chart, e.g. accounts by industry as a pie")}
            />
            <div className="mt-2">
              <Button onClick={onGenerate} disabled={gen || !q.trim()} className="!py-1.5 !text-xs">
                {gen ? <Spinner /> : <Sparkles className="h-3.5 w-3.5" />}
                {tr("生成", "Generate")}
              </Button>
            </div>
          </div>

          {/* 预览 */}
          {preview && (
            <div className="rounded-xl border border-gray-200 p-3">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">{tr("预览", "Preview")}</div>
              <ChartView type={type} data={preview} />
            </div>
          )}

          {/* 可编辑字段 */}
          <TextField label={tr("标题", "Title")} value={title} onChange={setTitle} placeholder={tr("图表标题", "Chart title")} />

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{tr("类型", "Type")}</span>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={type}
              onChange={(e) => setType(e.target.value as ChartType)}
            >
              {CHART_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{tr("数据源", "Source")}</span>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={source}
              onChange={(e) => { setSource(e.target.value); setPreview(null); }}
            >
              <option value="" disabled>{tr("选择数据源…", "Select source…")}</option>
              {sources.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
            </select>
          </label>

          {modalErr && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{modalErr}</div>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button onClick={onSave} disabled={saving || !title.trim() || !source}>
              {saving ? <Spinner /> : null}{tr("保存", "Save")}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
