import { useEffect, useState } from "react";
import { Megaphone, Mail, BarChart3, Webhook, Plus, Cloud, Zap } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, Button, Spinner, Modal, TextField } from "../components/ui";
import { StatCards, StatusPill, EmptyState } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import {
  listDestinations, createDestination, testDestination, type Destination,
} from "../api/connections";

const TYPE_META: Record<string, { icon: typeof Megaphone; zh: string; en: string }> = {
  ads: { icon: Megaphone, zh: "广告平台", en: "Ad Platforms" },
  marketing: { icon: Mail, zh: "营销自动化", en: "Marketing Automation" },
  bi: { icon: BarChart3, zh: "分析 / BI", en: "Analytics / BI" },
  webhook: { icon: Webhook, zh: "Webhook", en: "Webhook" },
};
const TYPE_OPTIONS = ["ads", "marketing", "bi", "webhook"];

export default function DestinationsPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [items, setItems] = useState<Destination[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("ads");
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  function load() {
    setItems(null); setErr(null);
    listDestinations(tenant).then(setItems).catch((e) => setErr(String(e)));
  }
  useEffect(load, [tenant]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      await createDestination(tenant, { destination_name: name.trim(), destination_type: type });
      setName(""); setOpen(false); load();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function doTest(id: string) {
    setTestResult((p) => ({ ...p, [id]: tr("测试中…", "Testing…") }));
    try {
      const r = await testDestination(tenant, id);
      setTestResult((p) => ({ ...p, [id]: r.ok ? tr(`连通 ${r.latency_ms}ms`, `Connected ${r.latency_ms}ms`) : (r.error || tr("失败", "Failed")) }));
    } catch (e) { setTestResult((p) => ({ ...p, [id]: String(e) })); }
  }

  return (
    <Layout
      title={tr("目的地 Destinations", "Destinations")}
      subtitle={tr("把清洗、统一后的数据激活到下游工具（广告 / 营销 / BI / Webhook）", "Activate cleansed and unified data to downstream tools (Ads / Marketing / BI / Webhook)")}
      actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {tr("添加目的地", "Add Destination")}</Button>}
    >
      {items && (
        <StatCards items={[
          { label: tr("目的地总数", "Total Destinations"), value: items.length },
          { label: tr("已启用", "Enabled"), value: items.filter((d) => d.enabled).length },
          { label: tr("已停用", "Disabled"), value: items.filter((d) => !d.enabled).length },
          { label: tr("类型", "Types"), value: new Set(items.map((d) => d.destination_type)).size },
        ]} />
      )}

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!items && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {items && items.length === 0 && (
        <EmptyState icon={Cloud} title={tr("还没有目的地", "No destinations yet")} desc={tr("添加一个目的地，把统一后的受众与档案激活到下游。", "Add a destination to activate unified audiences and profiles downstream.")}
          action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {tr("添加目的地", "Add Destination")}</Button>} />
      )}

      {items && items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((d) => {
            const meta = TYPE_META[d.destination_type] || { icon: Cloud, zh: d.destination_type, en: d.destination_type };
            return (
              <Card key={d.destination_id} className="flex h-full flex-col p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <meta.icon className="h-5 w-5" />
                  </div>
                  <StatusPill tone={d.enabled ? "green" : "gray"}>{d.enabled ? tr("已启用", "Enabled") : tr("已停用", "Disabled")}</StatusPill>
                </div>
                <div className="font-semibold text-gray-900">{d.destination_name}</div>
                <div className="text-[11px] uppercase tracking-wide text-gray-400">{tr(meta.zh, meta.en)}</div>
                <div className="mt-4 flex items-center gap-2">
                  <Button variant="outline" onClick={() => doTest(d.destination_id)}>
                    <Zap className="h-4 w-4" /> {tr("测试连接", "Test Connection")}
                  </Button>
                  {testResult[d.destination_id] && (
                    <span className="text-xs text-gray-500">{testResult[d.destination_id]}</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={open} title={tr("添加目的地", "Add Destination")} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label={tr("名称", "Name")} value={name} onChange={setName} placeholder={tr("如：巨量引擎受众 / 飞书 Webhook", "e.g. Ocean Engine Audience / Feishu Webhook")} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{tr("类型", "Type")}</span>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={type} onChange={(e) => setType(e.target.value)}>
              {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{TYPE_META[t] ? tr(TYPE_META[t].zh, TYPE_META[t].en) : t}</option>)}
            </select>
          </label>
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
