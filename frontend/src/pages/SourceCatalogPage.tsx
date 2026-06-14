import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, KeyRound, Copy, ArrowRight } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Button, Spinner, Modal, TextField } from "../components/ui";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import { createSource } from "../api/connections";
import { groupBySurface, categoryLabel, type Connector } from "../lib/connectors";

// 数据源目录：所有连接器平铺成卡片（按类别分组），点卡片填名称即创建。
export default function SourceCatalogPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Connector | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ source_id: string; write_key: string } | null>(null);

  const kw = q.trim().toLowerCase();
  const groups = groupBySurface("source")
    .map((g) => ({ ...g, items: g.items.filter((c) => c.label.toLowerCase().includes(kw) || c.key.includes(kw)) }))
    .filter((g) => g.items.length > 0);

  function pick(c: Connector) {
    setSel(c); setName(""); setCreated(null); setErr(null);
  }
  async function submit() {
    if (!sel || !name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await createSource(tenant, { source_name: name.trim(), source_type: sel.key });
      setCreated({ source_id: r.source_id, write_key: r.write_key });
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  return (
    <Layout
      title={tr("数据源目录 Source Catalog", "Source Catalog")}
      subtitle={tr("选择一个连接器接入数据 —— 数据库 / 数仓 / 数据湖 / 查询引擎 / 对象存储 / 流 全部平铺于此", "Pick a connector to ingest data — databases / warehouses / lakes / query engines / object stores / streams")}
      actions={<Link to="/connections"><Button variant="outline">{tr("返回数据源", "Back to Sources")}</Button></Link>}
    >
      <div className="mb-5 flex max-w-md items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 text-gray-400" />
        <input className="w-full text-sm focus:outline-none" placeholder={tr("搜索连接器…", "Search connectors…")}
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {groups.map((g) => (
        <div key={g.category} className="mb-7">
          <div className="mb-2.5 text-sm font-semibold text-gray-700">
            {categoryLabel(g.category, tr)} <span className="font-normal text-gray-400">· {g.items.length}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {g.items.map((c) => (
              <button key={c.key} onClick={() => pick(c)}
                className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left transition-shadow hover:border-brand-300 hover:shadow-md">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <c.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-gray-900">{c.label}</div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{c.key}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 && <div className="text-sm text-gray-500">{tr("没有匹配的连接器", "No matching connectors")}</div>}

      <Modal open={!!sel}
        title={created ? tr("数据源已创建", "Source created") : tr(`接入 ${sel?.label ?? ""}`, `Connect ${sel?.label ?? ""}`)}
        onClose={() => setSel(null)}>
        {created ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
              <div className="mb-1 flex items-center gap-1 font-medium"><KeyRound className="h-4 w-4" /> {tr("Write Key（仅此一次完整展示）", "Write Key (shown in full only once)")}</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs">{created.write_key}</code>
                <button className="rounded p-1 text-amber-700 hover:bg-amber-100"
                  onClick={() => navigator.clipboard?.writeText(created.write_key)} title={tr("复制", "Copy")}><Copy className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Link to={`/connections/sources/${created.source_id}`}><Button>{tr("查看详情", "View details")} <ArrowRight className="h-4 w-4" /></Button></Link>
              <Button variant="outline" onClick={() => setSel(null)}>{tr("完成", "Done")}</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {sel && <div className="flex items-center gap-2 text-sm text-gray-500"><sel.icon className="h-4 w-4 text-brand-600" /> {sel.label}</div>}
            <TextField label={tr("名称", "Name")} value={name} onChange={setName} placeholder={tr("如：业务库订单", "e.g. Order database")} />
            {err && <div className="text-sm text-red-600">{err}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSel(null)}>{tr("取消", "Cancel")}</Button>
              <Button onClick={submit} disabled={busy || !name.trim()}>
                {busy ? <Spinner /> : <Plus className="h-4 w-4" />} {tr("创建", "Create")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}
