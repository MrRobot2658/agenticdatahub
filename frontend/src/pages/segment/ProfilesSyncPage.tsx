import { useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Button, DataTable, Modal, TextField, Spinner } from "../../components/ui";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import { syncProfiles, type ProfileSyncInput, type ProfileSyncResult } from "../../api/unify";

const EMPTY: ProfileSyncInput = {
  job_name: "profile-sync", target_warehouse: "doris_dw",
  source_object: "doris_user_wide", tables: ["doris_user_wide"], schedule: "0 */15 * * * *",
};

export default function ProfilesSyncPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [runs, setRuns] = useState<ProfileSyncResult[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ProfileSyncInput>(EMPTY);
  const [tablesText, setTablesText] = useState("doris_user_wide");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const COL = {
    job: tr("任务", "Job"),
    run: tr("运行", "Run"),
    warehouse: tr("目标数仓", "Target warehouse"),
    tables: tr("同步表", "Synced tables"),
    rows: tr("行数", "Rows"),
    status: tr("状态", "Status"),
  };

  async function run() {
    if (!form.target_warehouse.trim()) { setError(tr("请填写目标数仓", "Please enter the target warehouse")); return; }
    setRunning(true); setError(null); setMsg(null);
    try {
      const r = await syncProfiles(tenant, {
        ...form,
        tables: tablesText.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setMsg(tr(`同步完成：job ${r.job_id} 写入 ${r.row_count} 行 → ${r.target_warehouse}`, `Sync complete: job ${r.job_id} wrote ${r.row_count} rows → ${r.target_warehouse}`));
      setRuns((prev) => [r, ...prev]);
      setOpen(false);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || tr("同步失败", "Sync failed"));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Layout
      title={tr("档案同步 Profiles Sync", "Profiles Sync")}
      subtitle={tr("将统一档案持续同步回数据仓库，供下游分析使用（Reverse-ETL）", "Continuously sync unified profiles back to the data warehouse for downstream analytics (Reverse-ETL)")}
      actions={<Button onClick={() => { setForm(EMPTY); setTablesText("doris_user_wide"); setError(null); setOpen(true); }}>
        <RefreshCw className="h-4 w-4" /> {tr("新建同步并执行", "New sync and run")}
      </Button>}
    >
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
      {msg && <div className="mb-4 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{msg}</div>}

      <Card className="p-2">
        {runs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Cloud className="h-6 w-6" />
            </div>
            <div className="font-semibold text-gray-900">{tr("尚无同步记录", "No sync records yet")}</div>
            <div className="max-w-sm text-sm text-gray-500">{tr("配置目标数仓与要回流的特征/标签表，点击执行将用户宽表同步至下游。", "Configure the target warehouse and the feature/tag tables to sync back, then run to sync the user wide table downstream.")}</div>
            <Button className="mt-2" onClick={() => setOpen(true)}>
              <RefreshCw className="h-4 w-4" /> {tr("新建同步并执行", "New sync and run")}
            </Button>
          </div>
        ) : (
          <DataTable
            columns={[COL.job, COL.run, COL.warehouse, COL.tables, COL.rows, COL.status]}
            rows={runs.map((r) => ({
              [COL.job]: r.job_id,
              [COL.run]: r.run_id,
              [COL.warehouse]: r.target_warehouse,
              [COL.tables]: (r.tables || []).join(", ") || "—",
              [COL.rows]: r.row_count,
              [COL.status]: r.status,
            }))}
          />
        )}
      </Card>

      <Modal open={open} title={tr("新建档案同步", "New profiles sync")} onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <TextField label={tr("任务名", "Job name")} value={form.job_name ?? ""}
            onChange={(v) => setForm({ ...form, job_name: v })} />
          <TextField label={tr("目标数仓 / warehouse_id", "Target warehouse / warehouse_id")} value={form.target_warehouse}
            placeholder="doris_dw" onChange={(v) => setForm({ ...form, target_warehouse: v })} />
          <TextField label={tr("源对象表", "Source object table")} value={form.source_object ?? ""}
            onChange={(v) => setForm({ ...form, source_object: v })} />
          <TextField label={tr("同步表（逗号分隔）", "Synced tables (comma-separated)")} value={tablesText} onChange={setTablesText} />
          <TextField label={tr("调度 cron（可选）", "Schedule cron (optional)")} value={form.schedule ?? ""}
            placeholder="0 */15 * * * *" onChange={(v) => setForm({ ...form, schedule: v })} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button onClick={run} disabled={running}>
              {running ? <Spinner /> : tr("执行同步", "Run sync")}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
