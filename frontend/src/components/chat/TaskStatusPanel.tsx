import { useEffect, useState } from "react";
import { Workflow, RefreshCw, ExternalLink, CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";
import { getSchedulerRuns, type DagRun, type SchedulerRuns } from "../../api/scheduler";
import { useLang } from "../../context/LangContext";

// 右侧任务状态面板：轮询 Airflow DAG 运行状态（全局），展示最近若干次运行。
const POLL_MS = 6000;

function StateBadge({ state }: { state: string | null }) {
  const s = (state || "").toLowerCase();
  const map: Record<string, { cls: string; icon: JSX.Element; label: string }> = {
    success: { cls: "bg-green-50 text-green-600", icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "成功" },
    failed: { cls: "bg-red-50 text-red-600", icon: <XCircle className="h-3.5 w-3.5" />, label: "失败" },
    running: { cls: "bg-brand-50 text-brand-600", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, label: "运行中" },
    queued: { cls: "bg-amber-50 text-amber-600", icon: <Clock className="h-3.5 w-3.5" />, label: "排队" },
  };
  const it = map[s] || { cls: "bg-gray-100 text-gray-500", icon: <Clock className="h-3.5 w-3.5" />, label: state || "—" };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${it.cls}`}>{it.icon}{it.label}</span>;
}

export default function TaskStatusPanel() {
  const { tr } = useLang();
  const [data, setData] = useState<SchedulerRuns | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try { setData(await getSchedulerRuns(20)); } catch (e: any) {
      setData({ engine: "airflow", reachable: false, ui_url: "", dag_id: "", runs: [], error: String(e) });
    } finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, []);

  const runs = data?.runs ?? [];
  const running = runs.filter((r) => (r.state || "").toLowerCase() === "running").length;

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-l border-gray-200 bg-white xl:flex">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
        <Workflow className="h-4 w-4 text-brand-600" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">{tr("任务状态", "Task Status")}</div>
          <div className="text-[11px] text-gray-400">{tr("Airflow 调度", "Airflow scheduler")}</div>
        </div>
        <button type="button" onClick={load} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title={tr("刷新", "Refresh")}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* 概览 */}
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-2 text-[12px]">
        <span className={`inline-flex items-center gap-1 ${data?.reachable ? "text-green-600" : "text-red-500"}`}>
          <span className={`h-2 w-2 rounded-full ${data?.reachable ? "bg-green-500" : "bg-red-400"}`} />
          {data?.reachable ? tr("已连接", "Connected") : tr("未连接", "Offline")}
        </span>
        {running > 0 && <span className="text-brand-600">{running} {tr("运行中", "running")}</span>}
        <span className="ml-auto text-gray-400">{runs.length} {tr("条", "runs")}</span>
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3">
        {!data?.reachable && (
          <div className="px-2 py-6 text-center text-[12px] text-gray-400">
            {tr("Airflow 暂不可达", "Airflow unreachable")}
            {data?.error && <div className="mt-1 break-all text-[10px] text-gray-300">{data.error}</div>}
          </div>
        )}
        {data?.reachable && runs.length === 0 && (
          <div className="px-2 py-6 text-center text-[12px] text-gray-400">{tr("暂无运行记录", "No runs yet")}</div>
        )}
        {runs.map((r) => <RunRow key={r.dag_run_id} run={r} />)}
      </div>

      {data?.ui_url && (
        <a href={`${data.ui_url}/dags/${data.dag_id}/grid`} target="_blank" rel="noreferrer"
          className="flex items-center justify-center gap-1.5 border-t border-gray-200 px-4 py-2.5 text-[12px] font-medium text-brand-600 hover:bg-brand-50">
          {tr("在 Airflow 中打开", "Open in Airflow")} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </aside>
  );
}

function RunRow({ run }: { run: DagRun }) {
  const when = (run.start_date || run.logical_date || "").replace("T", " ").slice(5, 16);
  return (
    <div className="rounded-lg border border-gray-100 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <StateBadge state={run.state} />
        <span className="shrink-0 text-[10px] text-gray-300">{when}</span>
      </div>
      <div className="mt-1 truncate text-[11px] text-gray-500" title={run.dag_run_id}>
        {run.pipeline_id ? `管道 ${run.pipeline_id}` : run.run_type || run.dag_run_id}
        {run.tenant_id ? ` · 租户 ${run.tenant_id}` : ""}
      </div>
    </div>
  );
}
