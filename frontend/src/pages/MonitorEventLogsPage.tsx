import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ScrollText } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Button, Spinner } from "../components/ui";
import { StatCards, StatusPill, type StatItem } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import {
  listDeliveryLogs,
  getDeliveryStats,
  type DeliveryLog,
  type DeliveryStat,
} from "../api/monitor";

const STATUS_FILTERS = ["", "success", "failed", "retry", "skipped"];

function statusTone(s: string): "green" | "amber" | "red" | "gray" {
  if (s === "success") return "green";
  if (s === "failed") return "red";
  if (s === "retry") return "amber";
  return "gray";
}

export default function MonitorEventLogsPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const STATUS_LABEL: Record<string, string> = {
    "": tr("全部", "All"),
    success: tr("成功", "Success"),
    failed: tr("失败", "Failed"),
    retry: tr("重试", "Retry"),
    skipped: tr("跳过", "Skipped"),
  };
  const [status, setStatus] = useState("");
  const [logs, setLogs] = useState<DeliveryLog[] | null>(null);
  const [stats, setStats] = useState<DeliveryStat[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    Promise.all([
      listDeliveryLogs(tenant, { status: status || undefined, limit: 200 }),
      getDeliveryStats(tenant, { group_by: "status", window_minutes: 1440 }),
    ])
      .then(([l, s]) => {
        setLogs(l);
        setStats(s);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [tenant, status]);

  useEffect(() => {
    load();
  }, [load]);

  const statItems: StatItem[] = (stats || []).map((s) => ({
    label: STATUS_LABEL[s.dimension || ""] || s.dimension || "—",
    value: s.cnt.toLocaleString(),
    sub: s.avg_latency != null ? `${tr("平均", "Avg")} ${Math.round(s.avg_latency)}ms` : undefined,
    tone: statusTone(s.dimension || ""),
  }));

  return (
    <Layout
      title={tr("事件日志 Event Logs", "Event Logs")}
      subtitle={tr(
        "实时事件投递日志，逐条追踪数据源到目的地的处理结果（来自 /monitor/delivery-logs · /delivery-stats）",
        "Real-time event delivery logs, tracking each record's processing result from source to destination (from /monitor/delivery-logs · /delivery-stats)",
      )}
      actions={
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {tr("刷新", "Refresh")}
        </Button>
      }
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      {stats && statItems.length > 0 && <StatCards items={statItems.slice(0, 4)} />}

      <div className="mb-4 flex flex-wrap gap-1">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s || "all"}
            onClick={() => setStatus(s)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              status === s
                ? "bg-brand-500 text-white"
                : "border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <Card className="p-2">
        <div className="flex items-center gap-2 px-3 pt-3 text-sm font-semibold text-gray-900">
          <ScrollText className="h-4 w-4 text-brand-500" /> {tr("投递日志", "Delivery Logs")}
        </div>
        {!logs ? (
          <div className="flex items-center gap-2 px-3 py-6 text-gray-500">
            <Spinner /> {tr("加载中…", "Loading…")}
          </div>
        ) : (
          (() => {
            const COL = {
              ts: tr("时间", "Time"),
              source: tr("数据源", "Source"),
              event: tr("事件", "Event"),
              destination: tr("目的地", "Destination"),
              status: tr("状态", "Status"),
              http: "HTTP",
              latency: tr("时延", "Latency"),
              error: tr("错误", "Error"),
            };
            return (
              <DataTable
                columns={[COL.ts, COL.source, COL.event, COL.destination, COL.status, COL.http, COL.latency, COL.error]}
                rows={logs.map((e) => ({
                  [COL.ts]: e.ts,
                  [COL.source]: e.source,
                  [COL.event]: e.event_name || "—",
                  [COL.destination]: e.destination || "—",
                  [COL.status]: <StatusPill tone={statusTone(e.status)}>{STATUS_LABEL[e.status] || e.status}</StatusPill>,
                  [COL.http]: e.http_code ?? "—",
                  [COL.latency]: e.latency_ms != null ? `${e.latency_ms}ms` : "—",
                  [COL.error]: e.error_message || "—",
                }))}
              />
            );
          })()
        )}
      </Card>
    </Layout>
  );
}
