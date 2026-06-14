import { useEffect, useState } from "react";
import { Plus, Play, RefreshCw } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, DataTable, Spinner, Button, Modal, TextField } from "../../components/ui";
import { StatCards, EmptyState } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import {
  listReverseEtlJobs, createReverseEtlJob, runReverseEtlNow, listReverseEtlRuns,
  listDestinations, type ReverseEtlJob, type ReverseEtlRun, type Destination,
} from "../../api/connections";

const SOURCE_OBJECTS = ["user", "account", "order", "product", "store", "lead"];

export default function ReverseEtlPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const COL = {
    job: tr("任务", "Job"),
    source: tr("源对象", "Source Object"),
    schedule: tr("调度", "Schedule"),
    enabled: tr("启用", "Enabled"),
    status: tr("状态", "Status"),
    actions: tr("操作", "Actions"),
  };
  const RUN_COL = {
    start: tr("开始时间", "Start Time"),
    rows: tr("行数", "Rows"),
    duration: tr("耗时", "Duration"),
    status: tr("状态", "Status"),
  };
  const [jobs, setJobs] = useState<ReverseEtlJob[] | null>(null);
  const [dests, setDests] = useState<Destination[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [obj, setObj] = useState("user");
  const [destId, setDestId] = useState("");
  const [cron, setCron] = useState("0 */15 * * * *");
  const [runs, setRuns] = useState<ReverseEtlRun[] | null>(null);
  const [activeJob, setActiveJob] = useState<ReverseEtlJob | null>(null);

  function load() {
    setJobs(null); setErr(null);
    listReverseEtlJobs(tenant).then(setJobs).catch((e) => setErr(String(e)));
    listDestinations(tenant).then((d) => { setDests(d); if (d[0]) setDestId(d[0].destination_id); }).catch(() => {});
  }
  useEffect(load, [tenant]);

  async function submit() {
    if (!name.trim() || !destId) return;
    setBusy(true); setErr(null);
    try {
      await createReverseEtlJob(tenant, { job_name: name.trim(), source_object: obj, destination_id: destId, schedule_cron: cron });
      setName(""); setOpen(false); load();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function runNow(job: ReverseEtlJob) {
    try { await runReverseEtlNow(tenant, job.job_id); load(); openRuns(job); }
    catch (e) { setErr(String(e)); }
  }

  async function openRuns(job: ReverseEtlJob) {
    setActiveJob(job); setRuns(null);
    try { setRuns(await listReverseEtlRuns(tenant, job.job_id)); }
    catch (e) { setErr(String(e)); setRuns([]); }
  }

  const rows = jobs || [];

  return (
    <Layout
      title={tr("反向 ETL Reverse ETL", "Reverse ETL")}
      subtitle={tr("将统一对象/数仓宽表按调度反向同步到目的地", "Sync unified objects / warehouse wide tables to destinations on a schedule")}
      actions={<Button onClick={() => setOpen(true)} disabled={dests.length === 0}><Plus className="h-4 w-4" /> {tr("新建任务", "New Job")}</Button>}
    >
      {jobs && (
        <StatCards items={[
          { label: tr("任务总数", "Total Jobs"), value: jobs.length },
          { label: tr("已启用", "Enabled"), value: jobs.filter((j) => j.enabled).length },
          { label: tr("目的地", "Destinations"), value: dests.length },
          { label: tr("运行中", "Running"), value: jobs.filter((j) => j.last_status === "running" || j.last_status === "pending").length },
        ]} />
      )}

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!jobs && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {jobs && jobs.length === 0 && (
        <EmptyState icon={RefreshCw} title={tr("还没有反向 ETL 任务", "No reverse ETL jobs yet")}
          desc={dests.length === 0 ? tr("请先在「目的地」创建一个目的地，再来新建反向同步任务。", "Create a destination under “Destinations” first, then add a reverse sync job.") : tr("新建一个任务，把对象数据按调度同步到目的地。", "Create a job to sync object data to a destination on a schedule.")}
          action={dests.length > 0 ? <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {tr("新建任务", "New Job")}</Button> : undefined} />
      )}

      {jobs && jobs.length > 0 && (
        <Card className="p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-400">
                {[COL.job, COL.source, COL.schedule, COL.enabled, COL.status, COL.actions].map((c) => <th key={c} className="px-4 py-3 font-semibold">{c}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">{r.job_name}</td>
                  <td className="px-4 py-3 text-gray-700">{r.source_object}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{r.schedule_cron}</td>
                  <td className="px-4 py-3 text-gray-700">{r.enabled ? tr("是", "Yes") : tr("否", "No")}</td>
                  <td className="px-4 py-3 text-gray-700">{r.last_status || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => runNow(r)}><Play className="h-4 w-4" /> {tr("立即运行", "Run Now")}</Button>
                      <Button variant="ghost" onClick={() => openRuns(r)}>{tr("运行记录", "Run History")}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={open} title={tr("新建反向 ETL 任务", "New Reverse ETL Job")} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label={tr("任务名称", "Job Name")} value={name} onChange={setName} placeholder={tr("如：高价值客户回流广告平台", "e.g. Sync high-value customers back to ad platform")} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{tr("源对象", "Source Object")}</span>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={obj} onChange={(e) => setObj(e.target.value)}>
              {SOURCE_OBJECTS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{tr("目的地", "Destination")}</span>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={destId} onChange={(e) => setDestId(e.target.value)}>
              {dests.map((d) => <option key={d.destination_id} value={d.destination_id}>{d.destination_name}</option>)}
            </select>
          </label>
          <TextField label={tr("调度 (cron)", "Schedule (cron)")} value={cron} onChange={setCron} placeholder="0 */15 * * * *" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button onClick={submit} disabled={busy || !name.trim() || !destId}>
              {busy ? <Spinner /> : <Plus className="h-4 w-4" />} {tr("创建", "Create")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!activeJob} title={`${tr("运行记录", "Run History")} · ${activeJob?.job_name || ""}`} onClose={() => setActiveJob(null)}>
        {!runs && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}
        {runs && (
          <DataTable
            columns={[RUN_COL.start, RUN_COL.rows, RUN_COL.duration, RUN_COL.status]}
            rows={runs.map((r) => ({
              [RUN_COL.start]: r.start_time, [RUN_COL.rows]: r.row_count, [RUN_COL.duration]: r.duration_ms != null ? `${r.duration_ms}ms` : "—", [RUN_COL.status]: r.status,
            }))}
          />
        )}
      </Modal>
    </Layout>
  );
}
