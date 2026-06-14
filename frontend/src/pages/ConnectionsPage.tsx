import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  FileSpreadsheet, Cloud, Plus, ArrowRight, Workflow,
} from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, Button, Spinner } from "../components/ui";
import { StatCards, StatusPill, EmptyState } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import { listSources, type Source } from "../api/connections";
import { connectorByKey } from "../lib/connectors";

function statusTone(s: string) {
  if (s === "active") return "green" as const;
  if (s === "paused" || s === "disabled") return "gray" as const;
  return "amber" as const;
}

export default function ConnectionsPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    setSources(null); setErr(null);
    listSources(tenant).then(setSources).catch((e) => setErr(String(e)));
  }
  useEffect(load, [tenant]);

  return (
    <Layout
      title={tr("数据源 Sources", "Sources")}
      subtitle={tr("把数据接入数据底座 —— 一次接入，导入任意对象（Track once, send everywhere）", "Connect data to the data foundation — track once, send everywhere")}
      actions={
        <>
          <Link to="/connections/flow">
            <Button variant="outline"><Workflow className="h-4 w-4" /> {tr("可视化编排", "Visual Flow")}</Button>
          </Link>
          <Link to="/connections/catalog">
            <Button><Plus className="h-4 w-4" /> {tr("添加数据源", "Add Source")}</Button>
          </Link>
        </>
      }
    >
      {sources && (
        <StatCards items={[
          { label: tr("数据源总数", "Total Sources"), value: sources.length },
          { label: tr("活跃", "Active"), value: sources.filter((s) => s.status === "active").length },
          { label: tr("近24h事件", "Events (24h)"), value: sources.reduce((a, s) => a + (s.event_count_24h || 0), 0).toLocaleString() },
          { label: tr("类型", "Types"), value: new Set(sources.map((s) => s.source_type)).size },
        ]} />
      )}

      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!sources && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {sources && sources.length === 0 && (
        <EmptyState
          icon={FileSpreadsheet}
          title={tr("还没有数据源", "No sources yet")}
          desc={tr("添加一个数据源开始接入数据，或用可视化 ETL 直接导入 CSV。", "Add a source to start ingesting data, or import a CSV directly with visual ETL.")}
          action={
            <div className="flex gap-2">
              <Link to="/connections/catalog"><Button><Plus className="h-4 w-4" /> {tr("添加数据源", "Add Source")}</Button></Link>
              <Link to="/connections/sources/new"><Button variant="outline">{tr("CSV 导入", "Import CSV")}</Button></Link>
            </div>
          }
        />
      )}

      {sources && sources.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sources.map((s) => {
            const c = connectorByKey(s.source_type);
            const meta = { icon: c?.icon ?? Cloud, label: c?.label ?? s.source_type };
            return (
              <Link key={s.source_id} to={`/connections/sources/${s.source_id}`}>
                <Card className="flex h-full flex-col p-5 transition-shadow hover:shadow-md">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <meta.icon className="h-5 w-5" />
                    </div>
                    <StatusPill tone={statusTone(s.status)}>{s.status}</StatusPill>
                  </div>
                  <div className="font-semibold text-gray-900">{s.source_name}</div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400">{meta.label}</div>
                  <div className="mt-2 text-sm text-gray-500">
                    {tr("近24h", "Last 24h")} <span className="font-medium text-gray-700">{(s.event_count_24h || 0).toLocaleString()}</span> {tr("事件", "events")}
                  </div>
                  <div className="mt-4 flex items-center gap-1 text-sm font-medium text-brand-600">
                    {tr("查看详情", "View details")} <ArrowRight className="h-4 w-4" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
