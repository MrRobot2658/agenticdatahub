import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Route as RouteIcon, Plus, Play, Workflow } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, Button, Spinner, Modal, TextField } from "../components/ui";
import { StatCards, StatusPill, EmptyState } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import { listPipelines, createPipeline, executePipeline, type Pipeline } from "../api/connections";

function tone(s: string) {
  if (s === "active" || s === "running") return "green" as const;
  if (s === "draft") return "gray" as const;
  return "amber" as const;
}

export default function PipelinesPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [items, setItems] = useState<Pipeline[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<Record<string, string>>({});

  function load() {
    setItems(null); setErr(null);
    listPipelines(tenant).then(setItems).catch((e) => setErr(String(e)));
  }
  useEffect(load, [tenant]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      await createPipeline(tenant, { pipeline_name: name.trim(), nodes: [], edges: [], status: "draft" });
      setName(""); setOpen(false); load();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function exec(p: Pipeline) {
    setMsg((m) => ({ ...m, [p.pipeline_id]: tr("执行中…", "Running…") }));
    try {
      const r = await executePipeline(tenant, p.pipeline_id);
      setMsg((m) => ({ ...m, [p.pipeline_id]: `${r.status} · ~${r.estimated_duration_ms}ms` }));
      load();
    } catch (e) { setMsg((m) => ({ ...m, [p.pipeline_id]: String(e) })); }
  }

  return (
    <Layout
      title={tr("管道 Pipelines", "Pipelines")}
      subtitle={tr("把可视化编排画布保存的拓扑作为可执行管道管理与运行", "Manage and run topologies saved from the visual orchestration canvas as executable pipelines")}
      actions={
        <>
          <Link to="/connections/flow"><Button variant="outline"><Workflow className="h-4 w-4" /> {tr("编排画布", "Flow Canvas")}</Button></Link>
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {tr("新建管道", "New Pipeline")}</Button>
        </>
      }
    >
      {items && (
        <StatCards items={[
          { label: tr("管道总数", "Total Pipelines"), value: items.length },
          { label: tr("草稿", "Draft"), value: items.filter((p) => p.status === "draft").length },
          { label: tr("已激活", "Active"), value: items.filter((p) => p.status === "active").length },
          { label: tr("总节点数", "Total Nodes"), value: items.reduce((a, p) => a + (p.node_count || 0), 0) },
        ]} />
      )}

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!items && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {items && items.length === 0 && (
        <EmptyState icon={RouteIcon} title={tr("还没有管道", "No pipelines yet")} desc={tr("在编排画布拖拽节点后保存为管道，或先新建一个空管道。", "Drag nodes onto the flow canvas and save as a pipeline, or create an empty pipeline first.")}
          action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {tr("新建管道", "New Pipeline")}</Button>} />
      )}

      {items && items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <Card key={p.pipeline_id} className="flex h-full flex-col p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <RouteIcon className="h-5 w-5" />
                </div>
                <StatusPill tone={tone(p.status)}>{p.status}</StatusPill>
              </div>
              <div className="font-semibold text-gray-900">{p.pipeline_name}</div>
              <div className="mt-1 text-sm text-gray-500">{p.node_count || 0} {tr("节点", "nodes")} · {p.edge_count || 0} {tr("连线", "edges")}</div>
              <div className="mt-1 text-xs text-gray-400">{tr("最近执行", "Last run")} {p.last_executed_time || "—"}</div>
              <div className="mt-4 flex items-center gap-2">
                <Button variant="outline" onClick={() => exec(p)}><Play className="h-4 w-4" /> {tr("执行", "Run")}</Button>
                {msg[p.pipeline_id] && <span className="text-xs text-gray-500">{msg[p.pipeline_id]}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} title={tr("新建管道", "New Pipeline")} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label={tr("名称", "Name")} value={name} onChange={setName} placeholder={tr("如：CSV → 字段映射 → 对象表", "e.g. CSV → Field Mapping → Object Table")} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button onClick={submit} disabled={busy || !name.trim()}>
              {busy ? <Spinner /> : <Plus className="h-4 w-4" />} {tr("创建", "Create")}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
