import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Layout from "../../components/layout/Layout";
import { Badge, Card, DataTable, Spinner, Button } from "../../components/ui";
import { StatCards } from "../../components/segment/kit";
import { getSource, listSourceEvents, type SourceDetail, type SourceEvent } from "../../api/connections";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";

export default function SourceDetailPage() {
  const { id = "" } = useParams();
  const { tenant } = useTenant();
  const { tr } = useLang();
  const COL = {
    time: tr("时间", "Time"),
    event: tr("事件", "Event"),
    anonymousId: "anonymousId",
    status: tr("状态", "Status"),
  };
  const [src, setSrc] = useState<SourceDetail | null>(null);
  const [events, setEvents] = useState<SourceEvent[]>([]);
  const [err, setErr] = useState<string | null>(null);

  function loadEvents() {
    listSourceEvents(tenant, id, 50).then(setEvents).catch(() => {});
  }

  useEffect(() => {
    setSrc(null); setErr(null);
    getSource(tenant, id)
      .then((s) => { setSrc(s); setEvents(s.recent_events || []); })
      .catch((e) => setErr(String(e)));
  }, [tenant, id]);

  const schemaEvents = src ? Array.from(new Set((src.recent_events || []).map((e) => e.event_type))) : [];
  const rows = events.map((r) => ({
    [COL.time]: r.timestamp || r.created_at,
    [COL.event]: r.event_type,
    [COL.anonymousId]: r.anonymousId,
    [COL.status]: r.status,
  }));

  return (
    <Layout
      title={src ? `${src.source_name} · ${tr("数据源详情", "Source Detail")}` : tr("数据源详情", "Source Detail")}
      subtitle={tr("实时事件、Schema 与 Debugger", "Live events, Schema and Debugger")}
      actions={
        <Link to="/connections" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="h-4 w-4" /> {tr("返回连接", "Back to Connections")}
        </Link>
      }
    >
      {err && <Card className="p-5 text-sm text-red-600">{err}</Card>}
      {!src && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {src && (
        <>
          <StatCards items={[
            { label: tr("近24h事件", "Events (24h)"), value: (src.event_count_24h || 0).toLocaleString() },
            { label: tr("类型", "Type"), value: src.source_type },
            { label: tr("状态", "Status"), value: src.status },
            { label: "Write Key", value: <span className="font-mono text-base">{src.write_key || "—"}</span> },
          ]} />

          <Card className="mb-6 p-5">
            <div className="mb-3 text-sm font-semibold text-gray-900">{tr("Schema 事件", "Schema Events")}</div>
            <div className="flex flex-wrap gap-2">
              {schemaEvents.length === 0 && <span className="text-sm text-gray-400">{tr("暂无事件", "No events")}</span>}
              {schemaEvents.map((e) => <Badge key={e} color="brand">{e}</Badge>)}
            </div>
          </Card>

          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-900">{tr("实时事件 (Debugger)", "Live Events (Debugger)")}</div>
            <Button variant="outline" onClick={loadEvents}>{tr("刷新", "Refresh")}</Button>
          </div>
          <DataTable columns={[COL.time, COL.event, COL.anonymousId, COL.status]} rows={rows} />
        </>
      )}
    </Layout>
  );
}
