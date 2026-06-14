import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, FileCheck2 } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, Modal, Spinner, TextField } from "../../components/ui";
import { StatCards, StatusPill, EmptyState } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import {
  listTrackingPlans, createTrackingPlan, deleteTrackingPlan,
  type TrackingPlan,
} from "../../api/protocols";

export default function TrackingPlansPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<TrackingPlan[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [sources, setSources] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    setPlans(null); setErr(null);
    listTrackingPlans(tenant).then(setPlans).catch((e) => setErr(String(e)));
  }
  useEffect(load, [tenant]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createTrackingPlan(tenant, {
        name: name.trim(),
        description: desc.trim() || null,
        sources: sources.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setOpen(false); setName(""); setDesc(""); setSources("");
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: TrackingPlan) {
    if (!confirm(tr(`删除埋点计划「${p.name}」及其全部事件？`, `Delete tracking plan "${p.name}" and all its events?`))) return;
    try {
      await deleteTrackingPlan(tenant, p.id);
      load();
    } catch (e) {
      setErr(String(e));
    }
  }

  const total = plans?.length ?? 0;
  const enabled = plans?.filter((p) => Number(p.enabled) === 1).length ?? 0;

  return (
    <Layout
      title={tr("埋点计划 Tracking Plans", "Tracking Plans")}
      subtitle={tr("校验事件 schema、治理数据质量，确保上报符合规范（来自 /protocols/tracking-plans）", "Validate event schemas and govern data quality to ensure reports meet spec (from /protocols/tracking-plans)")}
      actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {tr("新建计划", "New Plan")}</Button>}
    >
      <StatCards items={[
        { label: tr("埋点计划数", "Tracking Plans"), value: total },
        { label: tr("已启用", "Enabled"), value: enabled },
        { label: tr("已停用", "Disabled"), value: total - enabled },
      ]} />

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!plans && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {plans && plans.length === 0 && (
        <EmptyState
          icon={FileCheck2}
          title={tr("还没有埋点计划", "No tracking plans yet")}
          desc={tr("创建埋点计划以定义事件 schema，校验上报数据质量。", "Create a tracking plan to define event schemas and validate reported data quality.")}
          action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {tr("新建计划", "New Plan")}</Button>}
        />
      )}

      {plans && plans.length > 0 && (
        <Card className="p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-400">
                <th className="px-4 py-3 font-semibold">计划</th>
                <th className="px-4 py-3 font-semibold">描述</th>
                <th className="px-4 py-3 font-semibold">数据源</th>
                <th className="px-4 py-3 font-semibold">状态</th>
                <th className="px-4 py-3 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {plans.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-gray-50"
                  onClick={() => navigate(`/protocols/tracking-plans/${p.id}`)}>
                  <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                  <td className="px-4 py-3 text-gray-500">{p.description || "—"}</td>
                  <td className="px-4 py-3 text-gray-700">{(p.sources || []).join(", ") || "—"}</td>
                  <td className="px-4 py-3">
                    {Number(p.enabled) === 1
                      ? <StatusPill tone="green">启用</StatusPill>
                      : <StatusPill tone="gray">停用</StatusPill>}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <button className="text-gray-400 hover:text-red-600" onClick={() => remove(p)} title="删除">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={open} title="新建埋点计划" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label="计划名" value={name} onChange={setName} placeholder="如：电商核心埋点" />
          <TextField label="描述" value={desc} onChange={setDesc} placeholder="可选" />
          <TextField label="数据源（逗号分隔）" value={sources} onChange={setSources} placeholder="app, web, 小程序" />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={create} disabled={busy || !name.trim()}>{busy ? "创建中…" : "创建"}</Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
