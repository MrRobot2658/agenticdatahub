import { useEffect, useState, useCallback } from "react";
import { Plus, Play } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Button, DataTable, Modal, TextField, Spinner } from "../../components/ui";
import { StatCards } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import {
  listSqlTraits, createSqlTrait, executeSqlTrait, executeAllSqlTraits,
  type SqlTrait, type SqlTraitInput,
} from "../../api/unify";

const EMPTY: SqlTraitInput = {
  trait_code: "", trait_name: "",
  sql_query: "SELECT one_id AS object_id, COUNT(*) AS trait_value\nFROM doris_user_wide\nWHERE tenant_id = %(tenant_id)s\nGROUP BY one_id",
  warehouse_type: "mysql", schedule_type: "manual", object_type: "user", enabled: true,
};

export default function SqlTraitsPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const COL = {
    trait: tr("特征", "Trait"),
    code: tr("编码", "Code"),
    warehouse: tr("数仓", "Warehouse"),
    schedule: tr("调度", "Schedule"),
    lastRun: tr("最近运行", "Last Run"),
    rowCount: tr("命中行数", "Rows Hit"),
    resultCount: tr("结果数", "Results"),
  };
  const [rows, setRows] = useState<SqlTrait[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SqlTraitInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await listSqlTraits(tenant));
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || tr("加载失败", "Failed to load"));
    } finally {
      setLoading(false);
    }
  }, [tenant, tr]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.trait_code.trim() || !form.sql_query.trim()) { setError(tr("trait_code 与 SQL 必填", "trait_code and SQL are required")); return; }
    setSaving(true); setError(null);
    try {
      await createSqlTrait(tenant, form);
      setOpen(false); setForm(EMPTY);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || tr("保存失败", "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  async function run(traitId: string) {
    setRunning(traitId); setError(null); setMsg(null);
    try {
      const r = await executeSqlTrait(tenant, traitId);
      setMsg(tr(`执行完成：写入 ${r.row_count} 行，用时 ${r.elapsed_ms}ms`, `Done: wrote ${r.row_count} rows in ${r.elapsed_ms}ms`));
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || tr("执行失败", "Execution failed"));
    } finally {
      setRunning(null);
    }
  }

  async function runAll() {
    setRunning("__all__"); setError(null); setMsg(null);
    try {
      const r = await executeAllSqlTraits(tenant);
      setMsg(`全部执行完成：${r.executed} 个特征，共写入 ${r.row_count} 行`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || "执行失败");
    } finally {
      setRunning(null);
    }
  }

  const warehouses = new Set(rows.map((t) => t.warehouse_type));
  const coverage = rows.reduce((a, t) => a + (t.last_row_count || 0), 0);

  return (
    <Layout
      title="SQL 特征 SQL Traits"
      subtitle="用 SQL 在数据仓库内计算并回填用户特征（仅 SELECT，须含 tenant_id 过滤）"
      actions={<>
        <Button variant="outline" onClick={runAll} disabled={running === "__all__"}>
          <Play className="h-4 w-4" /> {running === "__all__" ? "执行中…" : "执行全部"}
        </Button>
        <Button onClick={() => { setForm(EMPTY); setError(null); setOpen(true); }}>
          <Plus className="h-4 w-4" /> 新建 SQL 特征
        </Button>
      </>}
    >
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
      {msg && <div className="mb-4 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{msg}</div>}
      <StatCards items={[
        { label: "特征数", value: rows.length },
        { label: "数仓类型", value: warehouses.size },
        { label: "覆盖行数", value: coverage },
      ]} />
      <Card className="p-2">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <DataTable
            columns={["特征", "编码", "数仓", "调度", "最近运行", "命中行数", "结果数", ""]}
            rows={rows.map((t) => ({
              "特征": t.trait_name || t.trait_code,
              "编码": t.trait_code,
              "数仓": t.warehouse_type,
              "调度": t.schedule_type,
              "最近运行": t.last_run_time ?? "—",
              "命中行数": t.last_row_count ?? "—",
              "结果数": t.result_count,
              "": (
                <button onClick={(e) => { e.stopPropagation(); run(t.trait_id); }}
                  disabled={running === t.trait_id}
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50">
                  <Play className="h-3.5 w-3.5" /> {running === t.trait_id ? "执行中" : "执行"}
                </button>
              ),
            }))}
          />
        )}
      </Card>

      <Modal open={open} title="新建 SQL 特征" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <TextField label="trait_code（编码）" value={form.trait_code}
            placeholder="total_orders" onChange={(v) => setForm({ ...form, trait_code: v })} />
          <TextField label="特征名" value={form.trait_name ?? ""}
            onChange={(v) => setForm({ ...form, trait_name: v })} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">SQL（需返回 object_id / trait_value 列）</span>
            <textarea className="h-36 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-brand-400 focus:outline-none"
              value={form.sql_query}
              onChange={(e) => setForm({ ...form, sql_query: e.target.value })} />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
