import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Activity } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Button, Spinner } from "../components/ui";
import { StatCards, Sparkline, StatusPill } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import {
  getOverview,
  listMetrics,
  listSources,
  type MonitorOverview,
  type MetricBucket,
  type SourceHealth,
} from "../api/monitor";

// 窗口预设（分钟）
const WINDOWS: { zh: string; en: string; minutes: number }[] = [
  { zh: "近 1 小时", en: "Last 1 hour", minutes: 60 },
  { zh: "近 6 小时", en: "Last 6 hours", minutes: 360 },
  { zh: "近 24 小时", en: "Last 24 hours", minutes: 1440 },
  { zh: "近 7 天", en: "Last 7 days", minutes: 10080 },
];

function sourceTone(rate: number | null): "green" | "amber" | "red" | "gray" {
  if (rate == null) return "gray";
  if (rate >= 99) return "green";
  if (rate >= 90) return "amber";
  return "red";
}

export default function MonitorDeliveryPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [windowMin, setWindowMin] = useState(60);
  const [ov, setOv] = useState<MonitorOverview | null>(null);
  const [metrics, setMetrics] = useState<MetricBucket[] | null>(null);
  const [sources, setSources] = useState<SourceHealth[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    Promise.all([
      getOverview(tenant, { window_minutes: windowMin }),
      listMetrics(tenant, { limit: 200 }),
      listSources(tenant),
    ])
      .then(([o, m, s]) => {
        setOv(o);
        setMetrics(m);
        setSources(s);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [tenant, windowMin]);

  useEffect(() => {
    load();
  }, [load]);

  // 折线：按桶聚合事件量（同桶不同 source 求和）
  const series = (() => {
    if (!metrics) return [];
    const byBucket = new Map<string, number>();
    for (const m of metrics) {
      byBucket.set(m.bucket_ts, (byBucket.get(m.bucket_ts) || 0) + (m.events_total || 0));
    }
    return [...byBucket.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([, v]) => v);
  })();

  return (
    <Layout
      title={tr("投递概览 Delivery Overview", "Delivery Overview")}
      subtitle={tr(
        "实时监控事件投递吞吐、成功率与各数据源健康度（来自 /monitor/overview · /metrics · /sources）",
        "Real-time monitoring of event delivery throughput, success rate and source health (from /monitor/overview · /metrics · /sources)"
      )}
      actions={
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {tr("刷新", "Refresh")}
        </Button>
      }
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      <div className="mb-4 flex flex-wrap gap-1">
        {WINDOWS.map((w) => (
          <button
            key={w.minutes}
            onClick={() => setWindowMin(w.minutes)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              windowMin === w.minutes
                ? "bg-brand-500 text-white"
                : "border border-gray-300 text-gray-600 hover:bg-gray-50"
            }`}
          >
            {tr(w.zh, w.en)}
          </button>
        ))}
      </div>

      <StatCards
        items={[
          { label: tr("事件总数", "Total Events"), value: ov ? ov.events_total.toLocaleString() : "…" },
          {
            label: tr("成功率", "Success Rate"),
            value: ov ? (ov.success_rate != null ? `${ov.success_rate}%` : "—") : "…",
            tone: ov && ov.success_rate != null ? sourceTone(ov.success_rate) : "gray",
          },
          { label: tr("失败数", "Failures"), value: ov ? ov.failed_count.toLocaleString() : "…" },
          {
            label: tr("平均 P95 时延", "Avg P95 Latency"),
            value: ov ? (ov.avg_latency_p95 != null ? `${Math.round(ov.avg_latency_p95)}ms` : "—") : "…",
          },
        ]}
      />

      <Card className="mb-6 p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Activity className="h-4 w-4 text-brand-500" /> {tr("事件量趋势", "Event Volume Trend")}
        </div>
        {!metrics ? (
          <div className="flex items-center gap-2 text-gray-500">
            <Spinner /> {tr("加载中…", "Loading…")}
          </div>
        ) : series.length ? (
          <Sparkline data={series} height={80} />
        ) : (
          <div className="py-6 text-center text-sm text-gray-400">{tr("暂无指标数据", "No metric data")}</div>
        )}
      </Card>

      <Card className="p-2">
        <div className="px-3 pt-3 text-sm font-semibold text-gray-900">{tr("数据源健康", "Source Health")}</div>
        {!sources ? (
          <div className="flex items-center gap-2 px-3 py-6 text-gray-500">
            <Spinner /> {tr("加载中…", "Loading…")}
          </div>
        ) : (
          (() => {
            const COL = {
              source: tr("数据源", "Source"),
              total: tr("事件总数", "Total Events"),
              success: tr("成功", "Success"),
              failed: tr("失败", "Failures"),
              rate: tr("成功率", "Success Rate"),
              last: tr("最近上报", "Last Reported"),
              status: tr("状态", "Status"),
            };
            return (
              <DataTable
                columns={[COL.source, COL.total, COL.success, COL.failed, COL.rate, COL.last, COL.status]}
                rows={sources.map((s) => ({
                  [COL.source]: s.source || "—",
                  [COL.total]: s.events_total.toLocaleString(),
                  [COL.success]: s.success_count.toLocaleString(),
                  [COL.failed]: s.failed_count.toLocaleString(),
                  [COL.rate]: s.success_rate != null ? `${s.success_rate}%` : "—",
                  [COL.last]: s.last_bucket_ts || "—",
                  [COL.status]: (
                    <StatusPill tone={sourceTone(s.success_rate)}>
                      {s.success_rate == null
                        ? tr("无数据", "No data")
                        : s.success_rate >= 99
                        ? tr("健康", "Healthy")
                        : s.success_rate >= 90
                        ? tr("降级", "Degraded")
                        : tr("异常", "Error")}
                    </StatusPill>
                  ),
                }))}
              />
            );
          })()
        )}
      </Card>
    </Layout>
  );
}
