import { useEffect, useState, type JSX } from "react";
import { RefreshCw, CheckCircle2, XCircle, Loader2, Clock, CalendarClock, ChevronDown } from "lucide-react";
import { getSchedulerRuns, getRunTasks, type DagRun, type SchedulerRuns, type TaskInstance } from "../../api/scheduler";
import { useLang } from "../../context/LangContext";

const POLL_MS = 6000;

function badge(state: string | null) {
  const s = (state || "").toLowerCase();
  const map: Record<string, { cls: string; icon: JSX.Element; label: string }> = {
    success: { cls: "bg-green-50 text-green-600", icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "成功" },
    failed: { cls: "bg-red-50 text-red-600", icon: <XCircle className="h-3.5 w-3.5" />, label: "失败" },
    running: { cls: "bg-brand-50 text-brand-600", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, label: "运行中" },
    up_for_retry: { cls: "bg-amber-50 text-amber-600", icon: <Clock className="h-3.5 w-3.5" />, label: "重试中" },
    queued: { cls: "bg-amber-50 text-amber-600", icon: <Clock className="h-3.5 w-3.5" />, label: "排队" },
    skipped: { cls: "bg-gray-100 text-gray-400", icon: <Clock className="h-3.5 w-3.5" />, label: "跳过" },
  };
  return map[s] || { cls: "bg-gray-100 text-gray-500", icon: <Clock className="h-3.5 w-3.5" />, label: state || "—" };
}
function StateBadge({ state }: { state: string | null }) {
  const it = badge(state);
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${it.cls}`}>{it.icon}{it.label}</span>;
}

export default function TasksPanel() {
  const { tr } = useLang();
  const [data, setData] = useState<SchedulerRuns | null>(null);
  const [loading, setLoading] = useState(false);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Record<string, TaskInstance[] | "loading">>({});

  async function load() {
    setLoading(true);
    try { setData(await getSchedulerRuns(20)); }
    catch (e: any) { setData({ engine: "airflow", reachable: false, ui_url: "", dag_id: "", runs: [], error: String(e) }); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); const t = setInterval(load, POLL_MS); return () => clearInterval(t); }, []);

  async function toggleRun(run: DagRun) {
    const id = run.dag_run_id;
    if (openRun === id) { setOpenRun(null); return; }
    setOpenRun(id);
    if (!tasks[id] || tasks[id] === "loading") {
      setTasks((m) => ({ ...m, [id]: "loading" }));
      try { const ts = await getRunTasks(id, data?.dag_id); setTasks((m) => ({ ...m, [id]: ts })); }
      catch { setTasks((m) => ({ ...m, [id]: [] })); }
    }
  }

  const runs = data?.runs ?? [];
  const running = runs.filter((r) => (r.state || "").toLowerCase() === "running").length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-brand-600" />
        <div className="flex-1 text-[11px] text-gray-400">{tr("Airflow 调度：点开运行查看其任务实例（run_node × N）", "Airflow: expand a run to see its task instances")}</div>
        <button type="button" onClick={load} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title={tr("刷新", "Refresh")}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex items-center gap-3 text-[12px]">
        <span className={`inline-flex items-center gap-1 ${data?.reachable ? "text-green-600" : "text-red-500"}`}>
          <span className={`h-2 w-2 rounded-full ${data?.reachable ? "bg-green-500" : "bg-red-400"}`} />
          {data?.reachable ? tr("已连接", "Connected") : tr("未连接", "Offline")}
        </span>
        {running > 0 && <span className="text-brand-600">{running} {tr("运行中", "running")}</span>}
        <span className="ml-auto text-gray-400">{runs.length} {tr("条", "runs")}</span>
      </div>

      {!data?.reachable && (
        <div className="rounded-lg bg-gray-50 px-3 py-4 text-center text-[12px] text-gray-400">
          {tr("Airflow 暂不可达", "Airflow unreachable")}
          {data?.error && <div className="mt-1 break-all text-[10px] text-gray-300">{data.error}</div>}
        </div>
      )}
      {data?.reachable && runs.length === 0 && (
        <div className="px-2 py-4 text-center text-[12px] text-gray-400">{tr("暂无运行记录", "No runs yet")}</div>
      )}

      <div className="space-y-1.5">
        {runs.map((r: DagRun) => {
          const when = (r.start_date || r.logical_date || "").replace("T", " ").slice(5, 16);
          const expanded = openRun === r.dag_run_id;
          const tl = tasks[r.dag_run_id];
          return (
            <div key={r.dag_run_id} className={`overflow-hidden rounded-lg border ${expanded ? "border-gray-200" : "border-gray-100"}`}>
              <button type="button" onClick={() => toggleRun(r)} className={`w-full px-2.5 py-2 text-left ${expanded ? "bg-gray-50" : "hover:bg-gray-50"}`}>
                <div className="flex items-center justify-between gap-2">
                  <StateBadge state={r.state} />
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-300">{when}</span>
                    <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </div>
                </div>
                <div className="mt-1 truncate text-[11px] text-gray-500" title={r.dag_run_id}>
                  {r.pipeline_id ? `管道 ${r.pipeline_id}` : r.run_type || r.dag_run_id}
                  {r.tenant_id ? ` · 租户 ${r.tenant_id}` : ""}
                </div>
              </button>
              {expanded && (
                <div className="border-t border-gray-100 bg-white px-2 py-1.5">
                  {tl === "loading" || tl === undefined ? (
                    <div className="py-2 text-center text-[11px] text-gray-400">{tr("加载任务…", "Loading tasks…")}</div>
                  ) : tl.length === 0 ? (
                    <div className="py-2 text-center text-[11px] text-gray-400">{tr("暂无任务实例", "No task instances")}</div>
                  ) : (
                    <div className="space-y-0.5">
                      {tl.map((t, i) => {
                        const it = badge(t.state);
                        return (
                          <div key={i} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-gray-50">
                            <span className="flex-1 truncate font-mono text-[11px] text-gray-600">
                              {t.task_id}{t.map_index >= 0 ? <span className="text-gray-400">[{t.map_index}]</span> : null}
                            </span>
                            {t.duration != null && <span className="text-[10px] tabular-nums text-gray-300">{t.duration.toFixed(1)}s</span>}
                            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${it.cls}`}>{it.icon}{it.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
