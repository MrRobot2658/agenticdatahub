import { useEffect, useState, type JSX } from "react";
import {
  Workflow, RefreshCw, ExternalLink, CheckCircle2, XCircle, Loader2, Clock,
  Database, Layers, Radio, Activity, CalendarClock, ChevronDown, Boxes,
} from "lucide-react";
import { getSchedulerRuns, type DagRun, type SchedulerRuns } from "../../api/scheduler";
import { getInfraStats, type InfraStats, type ObjectStat } from "../../api/platform";
import { useLang } from "../../context/LangContext";
import { useTenant } from "../../context/TenantContext";

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

// 明细名单（表名 / topic / 流）。undefined=加载中，null=不可达，[]=暂无
function NameList({ names }: { names: string[] | null | undefined }) {
  const { tr } = useLang();
  if (names === undefined) return <div className="px-1 py-3 text-center text-[11px] text-gray-400">{tr("加载中…", "Loading…")}</div>;
  if (names === null) return <div className="px-1 py-3 text-center text-[11px] text-gray-400">{tr("服务暂不可达", "Service unreachable")}</div>;
  if (names.length === 0) return <div className="px-1 py-3 text-center text-[11px] text-gray-400">{tr("暂无", "None")}</div>;
  return (
    <div className="max-h-56 space-y-0.5 overflow-y-auto">
      {names.map((n) => (
        <div key={n} className="truncate rounded px-2 py-1 font-mono text-[11px] text-gray-600 hover:bg-gray-50" title={n}>{n}</div>
      ))}
    </div>
  );
}

// 业务对象记录数明细（label + count）
function ObjectCountList({ objects }: { objects: ObjectStat[] | undefined }) {
  const { tr } = useLang();
  if (objects === undefined) return <div className="px-1 py-3 text-center text-[11px] text-gray-400">{tr("加载中…", "Loading…")}</div>;
  if (objects.length === 0) return <div className="px-1 py-3 text-center text-[11px] text-gray-400">{tr("暂无", "None")}</div>;
  return (
    <div className="max-h-56 space-y-0.5 overflow-y-auto">
      {objects.map((o) => (
        <div key={o.key} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-50">
          <span className="flex-1 truncate text-[12px] text-gray-600">{o.label}<span className="ml-1 font-mono text-[10px] text-gray-300">{o.key}</span></span>
          <span className="font-mono text-[12px] font-semibold tabular-nums text-gray-900">{o.count === null ? "—" : o.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function TaskStatusPanel() {
  const { tr } = useLang();
  const { tenant } = useTenant();
  const [data, setData] = useState<SchedulerRuns | null>(null);
  const [stats, setStats] = useState<InfraStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);   // 当前展开的中间件（单开手风琴）

  async function load() {
    setLoading(true);
    try { setData(await getSchedulerRuns(20)); } catch (e: any) {
      setData({ engine: "airflow", reachable: false, ui_url: "", dag_id: "", runs: [], error: String(e) });
    } finally { setLoading(false); }
    getInfraStats(tenant).then(setStats).catch(() => {});
  }

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [tenant]);

  const runs = data?.runs ?? [];
  const running = runs.filter((r) => (r.state || "").toLowerCase() === "running").length;
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : String(n));

  // 固定顺序：数据源表 · Kafka 队列 · Flink 任务数 · Airflow 任务 · Doris 表 · 对象
  type InfraItem = { key: string; icon: JSX.Element; label: string; val: string; names?: string[] | null; airflow?: boolean; objects?: ObjectStat[] };
  const items: InfraItem[] = [
    { key: "mysql", icon: <Database className="h-4 w-4 text-sky-600" />, label: tr("数据源表", "Source tables"), val: fmt(stats?.mysql_tables), names: stats?.mysql_table_names },
    { key: "kafka", icon: <Radio className="h-4 w-4 text-amber-600" />, label: tr("Kafka 队列", "Kafka topics"), val: fmt(stats?.kafka_topics), names: stats?.kafka_topic_names },
    { key: "flink", icon: <Activity className="h-4 w-4 text-emerald-600" />, label: tr("Flink 任务数", "Flink jobs"), val: fmt(stats?.flink_jobs), names: stats?.flink_streams },
    { key: "airflow", icon: <CalendarClock className="h-4 w-4 text-brand-600" />, label: tr("Airflow 任务", "Airflow tasks"), val: fmt(data?.reachable ? runs.length : null), airflow: true },
    { key: "doris", icon: <Layers className="h-4 w-4 text-violet-600" />, label: tr("Doris 表", "Doris tables"), val: fmt(stats?.doris_tables), names: stats?.doris_table_names },
    { key: "objects", icon: <Boxes className="h-4 w-4 text-rose-600" />, label: tr("对象", "Objects"), val: fmt(stats?.object_types), objects: stats?.objects },
  ];

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-l border-gray-200 bg-white xl:flex">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
        <Workflow className="h-4 w-4 text-brand-600" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">{tr("数据底座", "Data Foundation")}</div>
          <div className="text-[11px] text-gray-400">{tr("点击数字查看详情", "Click a number for details")}</div>
        </div>
        <button type="button" onClick={load} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title={tr("刷新", "Refresh")}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {items.map((it) => {
          const expanded = open === it.key;
          return (
            <div key={it.key} className={`overflow-hidden rounded-lg border ${expanded ? "border-gray-200" : "border-gray-100"}`}>
              <button
                type="button"
                onClick={() => setOpen((o) => (o === it.key ? null : it.key))}
                className={`flex w-full items-center gap-2 px-2.5 py-2 text-left ${expanded ? "bg-gray-50" : "bg-gray-50/60 hover:bg-gray-50"}`}
              >
                {it.icon}
                <span className="flex-1 truncate text-[12px] text-gray-600">{it.label}</span>
                <span className="text-[15px] font-bold tabular-nums text-gray-900">{it.val}</span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>
              {expanded && (
                <div className="border-t border-gray-100 bg-white px-2 py-1.5">
                  {it.airflow ? (
                    <AirflowDetail data={data} runs={runs} running={running} />
                  ) : it.objects !== undefined || it.key === "objects" ? (
                    <ObjectCountList objects={it.objects} />
                  ) : (
                    <NameList names={it.names} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function AirflowDetail({ data, runs, running }: { data: SchedulerRuns | null; runs: DagRun[]; running: number }) {
  const { tr } = useLang();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3 px-1 text-[12px]">
        <span className={`inline-flex items-center gap-1 ${data?.reachable ? "text-green-600" : "text-red-500"}`}>
          <span className={`h-2 w-2 rounded-full ${data?.reachable ? "bg-green-500" : "bg-red-400"}`} />
          {data?.reachable ? tr("已连接", "Connected") : tr("未连接", "Offline")}
        </span>
        {running > 0 && <span className="text-brand-600">{running} {tr("运行中", "running")}</span>}
        <span className="ml-auto text-gray-400">{runs.length} {tr("条", "runs")}</span>
      </div>

      {!data?.reachable && (
        <div className="px-2 py-4 text-center text-[12px] text-gray-400">
          {tr("Airflow 暂不可达", "Airflow unreachable")}
          {data?.error && <div className="mt-1 break-all text-[10px] text-gray-300">{data.error}</div>}
        </div>
      )}
      {data?.reachable && runs.length === 0 && (
        <div className="px-2 py-4 text-center text-[12px] text-gray-400">{tr("暂无运行记录", "No runs yet")}</div>
      )}
      <div className="max-h-56 space-y-1.5 overflow-y-auto">
        {runs.map((r) => <RunRow key={r.dag_run_id} run={r} />)}
      </div>

      {data?.ui_url && (
        <a href={`${data.ui_url}/dags/${data.dag_id}/grid`} target="_blank" rel="noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-md border border-gray-100 px-3 py-1.5 text-[12px] font-medium text-brand-600 hover:bg-brand-50">
          {tr("在 Airflow 中打开", "Open in Airflow")} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}
