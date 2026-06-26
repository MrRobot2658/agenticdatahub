import { useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { X, LayoutDashboard, RefreshCw } from "lucide-react";
import { listDashboards, getDashboard, type Dashboard, type Chart } from "../../api/analyst";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#ec4899", "#84cc16"];

function ChartView({ chart }: { chart: Chart }) {
  const data = chart.data || [];
  let inner: any = null;
  if (chart.type === "pie") {
    inner = (
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={80} label={(e: any) => e.label}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
      </PieChart>
    );
  } else if (chart.type === "line") {
    inner = (<LineChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" fontSize={11} /><YAxis fontSize={11} /><Tooltip /><Line type="monotone" dataKey="value" stroke="#6366f1" /></LineChart>);
  } else if (chart.type === "area") {
    inner = (<AreaChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" fontSize={11} /><YAxis fontSize={11} /><Tooltip /><Area type="monotone" dataKey="value" stroke="#6366f1" fill="#c7d2fe" /></AreaChart>);
  } else {
    inner = (<BarChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" fontSize={11} /><YAxis fontSize={11} /><Tooltip /><Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} /></BarChart>);
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="mb-1 text-sm font-medium text-gray-800">{chart.title}</div>
      <div className="text-[11px] text-gray-400 mb-1">{chart.type} · {data.length} 项</div>
      <div className="h-52 w-full">{data.length ? <ResponsiveContainer width="100%" height="100%">{inner}</ResponsiveContainer> : <div className="grid h-full place-items-center text-[13px] text-gray-400">无数据</div>}</div>
    </div>
  );
}

export default function DashboardModal({ open, id, onClose }: { open: boolean; id?: string; onClose: () => void }) {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [list, setList] = useState<Dashboard[]>([]);
  const [sel, setSel] = useState<string | undefined>(id);
  const [board, setBoard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (open) listDashboards(tenant).then((d) => { setList(d); setSel((s) => s || id || d[0]?.id); }).catch(() => setList([])); }, [open, tenant]);
  useEffect(() => { if (open && id) setSel(id); }, [id, open]);
  useEffect(() => {
    if (!open || !sel) { setBoard(null); return; }
    setLoading(true);
    getDashboard(tenant, sel).then(setBoard).catch(() => setBoard(null)).finally(() => setLoading(false));
  }, [sel, open, tenant]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex h-[82vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-gray-50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 左：看板列表 */}
        <div className="flex w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
          <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
            <LayoutDashboard className="h-4 w-4 text-brand-600" />
            <span className="flex-1 text-sm font-semibold">{tr("看板", "Dashboards")}</span>
            <button onClick={() => listDashboards(tenant).then(setList)} className="rounded p-1 text-gray-400 hover:bg-gray-100" title={tr("刷新", "Refresh")}><RefreshCw className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {list.length === 0 && <div className="px-2 py-4 text-center text-[12px] text-gray-400">{tr("暂无看板，去对话里说「做一个看板」", "No dashboards yet")}</div>}
            {list.map((d) => (
              <button key={d.id} onClick={() => setSel(d.id)}
                className={`mb-1 block w-full rounded-lg px-3 py-2 text-left text-[13px] ${sel === d.id ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200" : "text-gray-600 hover:bg-gray-50"}`}>
                <div className="truncate font-medium">{d.title}</div>
                <div className="text-[10px] text-gray-400">{(d.sources || []).length || d.chart_count || 0} {tr("图表", "charts")}</div>
              </button>
            ))}
          </div>
        </div>
        {/* 右：看板内容 */}
        <div className="flex flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-5 py-3">
            <span className="flex-1 text-base font-semibold text-gray-900">{board?.title || tr("看板查看器", "Dashboard viewer")}</span>
            <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {loading && <div className="grid h-40 place-items-center text-sm text-gray-400">{tr("加载中…", "Loading…")}</div>}
            {!loading && board && (board.charts || []).length === 0 && <div className="grid h-40 place-items-center text-sm text-gray-400">{tr("该看板暂无图表", "No charts")}</div>}
            {!loading && board && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {(board.charts || []).map((c, i) => <ChartView key={i} chart={c} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
