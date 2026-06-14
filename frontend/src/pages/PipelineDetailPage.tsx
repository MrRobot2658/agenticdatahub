import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Play, ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, Button, Spinner, DataTable } from "../components/ui";
import { StatCards, StatusPill } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import {
  getPipeline, executePipeline, schedulerHealth,
  type PipelineDetail, type SchedulerInfo,
} from "../api/connections";

function tone(s: string) {
  if (s === "active" || s === "running") return "green" as const;
  if (s === "draft") return "gray" as const;
  return "amber" as const;
}

export default function PipelineDetailPage() {
  const { id = "" } = useParams();
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [p, setP] = useState<PipelineDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sched, setSched] = useState<SchedulerInfo | null>(null);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [runUrl, setRunUrl] = useState<string | null>(null);

  function load() {
    setP(null); setErr(null);
    getPipeline(tenant, id).then(setP).catch((e) => setErr(e?.response?.data?.detail || String(e)));
  }
  useEffect(load, [tenant, id]);
  useEffect(() => { schedulerHealth().then(setSched).catch(() => setSched({ reachable: false })); }, []);

  async function run() {
    setRunning(true); setRunMsg(null); setRunUrl(null);
    try {
      const r = await executePipeline(tenant, id);
      const dr = r.scheduler?.dag_run;
      setRunMsg(dr
        ? tr(`已触发 Airflow · ${dr.dag_run_id} · ${dr.state ?? ""}`, `Triggered on Airflow · ${dr.dag_run_id} · ${dr.state ?? ""}`)
        : (r.scheduler && !r.scheduler.reachable
            ? tr("调度器不可达（本地模拟）", "Scheduler unreachable (local sim)")
            : `${r.status}`));
      if (r.scheduler?.ui_url) setRunUrl(r.scheduler.ui_url);
      load();
    } catch (e: any) {
      setRunMsg(e?.response?.data?.detail || String(e));
    } finally { setRunning(false); }
  }

  const NCOL = { id: tr("节点", "Node"), label: tr("名称", "Label"), kind: tr("类别", "Kind") };
  const ECOL = { from: tr("源", "From"), to: tr("目标", "To") };

  return (
    <Layout
      title={p ? p.pipeline_name : tr("管道详情", "Pipeline")}
      subtitle={tr("管道拓扑与运行 —— 在 Airflow 上执行并查看状态", "Pipeline topology and runs — execute on Airflow and track status")}
      actions={
        <>
          <Link to="/connections/pipelines"><Button variant="outline"><ArrowLeft className="h-4 w-4" /> {tr("返回列表", "Back")}</Button></Link>
          <Button onClick={run} disabled={running || !p}><Play className="h-4 w-4" /> {running ? tr("执行中…", "Running…") : tr("执行", "Run")}</Button>
        </>
      }
    >
      {sched && (
        <div className={`mb-4 flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm ${
          sched.reachable ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          <div className="flex items-center gap-2">
            {sched.reachable ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            <span className="font-medium">{tr("调度器 Airflow", "Scheduler · Airflow")}</span>
            <span className="text-xs opacity-80">
              {sched.reachable ? tr(`已连接 · DAG ${sched.dag_id ?? ""}`, `Connected · DAG ${sched.dag_id ?? ""}`) : tr("未连接（运行将本地模拟）", "Not connected (local sim)")}
            </span>
          </div>
          {sched.ui_url && <a href={sched.ui_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium hover:underline">{tr("打开 Airflow", "Open Airflow")} <ExternalLink className="h-3.5 w-3.5" /></a>}
        </div>
      )}

      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!p && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {p && (
        <>
          <div className="mb-4 flex items-center gap-3">
            <StatusPill tone={tone(p.status)}>{p.status}</StatusPill>
            <span className="text-xs text-gray-400">{p.pipeline_id}</span>
          </div>

          {runMsg && (
            <div className="mb-4 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">
              {runMsg}{" "}
              {runUrl && <a href={runUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline">{tr("查看运行", "View run")} <ExternalLink className="h-3.5 w-3.5" /></a>}
            </div>
          )}

          <StatCards items={[
            { label: tr("节点数", "Nodes"), value: p.nodes?.length ?? 0 },
            { label: tr("连线数", "Edges"), value: p.edges?.length ?? 0 },
            { label: tr("执行次数", "Runs"), value: p.execution_count ?? 0 },
            { label: tr("最近执行", "Last run"), value: p.last_executed_time || "—" },
          ]} />

          <div className="mb-2 mt-6 text-sm font-semibold text-gray-700">{tr("节点", "Nodes")}</div>
          <Card className="mb-6 p-2">
            <DataTable
              columns={[NCOL.id, NCOL.label, NCOL.kind]}
              rows={(p.nodes ?? []).map((n: any) => ({
                [NCOL.id]: n.id ?? "—",
                [NCOL.label]: n.label ?? n.type ?? "—",
                [NCOL.kind]: n.kind ?? "—",
              }))}
            />
          </Card>

          <div className="mb-2 text-sm font-semibold text-gray-700">{tr("连线", "Edges")}</div>
          <Card className="p-2">
            <DataTable
              columns={[ECOL.from, ECOL.to]}
              rows={(p.edges ?? []).map((e: any) => ({
                [ECOL.from]: e.source ?? "—",
                [ECOL.to]: e.target ?? "—",
              }))}
            />
          </Card>
        </>
      )}
    </Layout>
  );
}
