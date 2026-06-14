import { useEffect, useState } from "react";
import { Plus, Trash2, Wand2 } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, Modal, Spinner, TextField } from "../../components/ui";
import { StatCards, StatusPill, EmptyState } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import {
  listTransformations, createTransformation, deleteTransformation,
  updateTransformation, type Transformation,
} from "../../api/protocols";

export default function TransformationsPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const TYPE_LABEL: Record<string, string> = {
    rename: tr("重命名", "Rename"),
    delete: tr("删除", "Delete"),
    mapping: tr("映射", "Mapping"),
  };
  const [rows, setRows] = useState<Transformation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState("");
  const [type, setType] = useState("rename");
  const [config, setConfig] = useState("{\n  \n}");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    setRows(null); setErr(null);
    listTransformations(tenant).then(setRows).catch((e) => setErr(String(e)));
  }
  useEffect(load, [tenant]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      let cfg: Record<string, any> | null = null;
      if (config.trim()) cfg = JSON.parse(config);
      await createTransformation(tenant, {
        name: name.trim(),
        scope: scope.trim() || "all_events",
        type,
        config: cfg,
        description: desc.trim() || null,
        enabled: true,
      });
      setOpen(false); setName(""); setScope(""); setConfig("{\n  \n}"); setDesc("");
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(t: Transformation) {
    try {
      await updateTransformation(tenant, t.id, { enabled: Number(t.enabled) !== 1 });
      load();
    } catch (e) { setErr(String(e)); }
  }

  async function remove(t: Transformation) {
    if (!confirm(`删除转换规则「${t.name}」？`)) return;
    try { await deleteTransformation(tenant, t.id); load(); }
    catch (e) { setErr(String(e)); }
  }

  const enabled = rows?.filter((t) => Number(t.enabled) === 1).length ?? 0;

  return (
    <Layout
      title="数据转换 Transformations"
      subtitle="在事件入库前对其做重命名/删除/映射，统一下游数据口径（来自 /protocols/transformations）"
      actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建转换</Button>}
    >
      <StatCards items={[
        { label: "转换数", value: rows?.length ?? "—" },
        { label: "启用", value: enabled },
        { label: "停用", value: (rows?.length ?? 0) - enabled },
      ]} />

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {rows && rows.length === 0 && (
        <EmptyState
          icon={Wand2}
          title="还没有转换规则"
          desc="创建转换规则，在事件入库前对属性做重命名、删除或映射。"
          action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> 新建转换</Button>}
        />
      )}

      {rows && rows.length > 0 && (
        <Card className="p-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-400">
                <th className="px-4 py-3 font-semibold">转换</th>
                <th className="px-4 py-3 font-semibold">作用范围</th>
                <th className="px-4 py-3 font-semibold">类型</th>
                <th className="px-4 py-3 font-semibold">状态</th>
                <th className="px-4 py-3 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                  <td className="px-4 py-3 text-gray-700">{t.scope || "all_events"}</td>
                  <td className="px-4 py-3 text-gray-700">{TYPE_LABEL[t.type] || t.type}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggle(t)}>
                      {Number(t.enabled) === 1
                        ? <StatusPill tone="green">启用</StatusPill>
                        : <StatusPill tone="gray">停用</StatusPill>}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button className="text-gray-400 hover:text-red-600" onClick={() => remove(t)} title="删除">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={open} title="新建转换规则" onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label="名称" value={name} onChange={setName} placeholder="如：统一订单金额字段名" />
          <TextField label="作用范围" value={scope} onChange={setScope} placeholder="某事件名 或 all_events" />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">类型</span>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={type} onChange={(e) => setType(e.target.value)}>
              <option value="rename">重命名 rename</option>
              <option value="delete">删除 delete</option>
              <option value="mapping">映射 mapping</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">规则配置（JSON）</span>
            <textarea className="h-28 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-brand-400 focus:outline-none"
              value={config} onChange={(e) => setConfig(e.target.value)}
              placeholder={'{ "from": "amount", "to": "total" }'} />
          </label>
          <TextField label="描述" value={desc} onChange={setDesc} placeholder="可选" />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={create} disabled={busy || !name.trim()}>{busy ? "创建中…" : "创建"}</Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
