import { useEffect, useMemo, useState } from "react";
import { Search, Check, Plus } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, Button, Spinner } from "../components/ui";
import { StatCards } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import { groupApps, appCategoryLabel } from "../lib/apps";
import { listInstalledApps, setApp, type InstalledApp } from "../api/apps";

// 应用市场：按类别平铺应用，连接/断开状态存后端（按租户）。
export default function AppsPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [q, setQ] = useState("");
  const [installed, setInstalled] = useState<InstalledApp[] | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string | null>(null);

  function load() {
    setErr(null);
    listInstalledApps(tenant).then(setInstalled).catch((e) => setErr(String(e)));
  }
  useEffect(() => { setInstalled(null); load(); /* eslint-disable-next-line */ }, [tenant]);

  const statusOf = useMemo(() => {
    const m: Record<string, string> = {};
    (installed || []).forEach((a) => { m[a.app_key] = a.status; });
    return m;
  }, [installed]);

  async function toggle(appKey: string) {
    const next = statusOf[appKey] === "active" ? "inactive" : "active";
    setBusy((b) => ({ ...b, [appKey]: true }));
    try { await setApp(tenant, appKey, next); load(); }
    catch (e) { setErr(String(e)); }
    finally { setBusy((b) => ({ ...b, [appKey]: false })); }
  }

  const kw = q.trim().toLowerCase();
  const groups = groupApps()
    .map((g) => ({ ...g, items: g.items.filter((a) => a.name.toLowerCase().includes(kw) || a.desc.includes(q.trim())) }))
    .filter((g) => g.items.length > 0);

  const connectedCount = (installed || []).filter((a) => a.status === "active").length;
  const totalApps = groupApps().reduce((n, g) => n + g.items.length, 0);

  return (
    <Layout
      title={tr("应用 Apps", "Apps")}
      subtitle={tr("连接 CRM、广告、消息、分析等第三方应用，把数据底座接到业务系统", "Connect CRM, ads, messaging and analytics apps to wire the data foundation into your business systems")}
    >
      {installed && (
        <StatCards items={[
          { label: tr("可用应用", "Available"), value: totalApps },
          { label: tr("已连接", "Connected"), value: connectedCount },
          { label: tr("类别", "Categories"), value: groupApps().length },
          { label: tr("租户", "Tenant"), value: tenant },
        ]} />
      )}

      <div className="mb-5 flex max-w-md items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 text-gray-400" />
        <input className="w-full text-sm focus:outline-none" placeholder={tr("搜索应用…", "Search apps…")}
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!installed && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {installed && groups.map((g) => (
        <div key={g.category} className="mb-7">
          <div className="mb-2.5 text-sm font-semibold text-gray-700">
            {appCategoryLabel(g.category, tr)} <span className="font-normal text-gray-400">· {g.items.length}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((a) => {
              const connected = statusOf[a.key] === "active";
              return (
                <Card key={a.key} className="flex items-start gap-3 p-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <a.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-gray-900">{a.name}</span>
                      {connected && <span className="inline-flex items-center gap-0.5 rounded-full bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700"><Check className="h-3 w-3" /> {tr("已连接", "Connected")}</span>}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">{a.desc}</div>
                    <div className="mt-3">
                      <Button variant={connected ? "outline" : "primary"} disabled={busy[a.key]}
                        onClick={() => toggle(a.key)} className="!py-1.5 !text-xs">
                        {busy[a.key] ? <Spinner /> : (connected ? null : <Plus className="h-3.5 w-3.5" />)}
                        {connected ? tr("断开", "Disconnect") : tr("连接", "Connect")}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
      {installed && groups.length === 0 && <div className="text-sm text-gray-500">{tr("没有匹配的应用", "No matching apps")}</div>}
    </Layout>
  );
}
