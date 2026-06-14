import Layout from "../../components/layout/Layout";
import { Card, DataTable } from "../../components/ui";
import { StatCards, MockTag, Sparkline } from "../../components/segment/kit";
import { deliveryMetrics, sourcesHealth } from "../../mock/data";
import { useLang } from "../../context/LangContext";

export default function DeliveryPage() {
  const { tr } = useLang();
  const COL = {
    source: tr("数据源", "Source"),
    events: tr("近24h事件", "Events (24h)"),
    errorRate: tr("错误率", "Error Rate"),
    status: tr("状态", "Status"),
  };
  return (
    <Layout
      title={tr("投递概览 Delivery Overview", "Delivery Overview")}
      subtitle={tr("实时监控事件投递吞吐、成功率与各数据源健康度", "Monitor event delivery throughput, success rate, and source health in real time")}
      actions={<MockTag />}
    >
      <StatCards items={[
        { label: tr("近24h事件", "Events (24h)"), value: deliveryMetrics.events24h.toLocaleString() },
        { label: tr("成功率", "Success Rate"), value: `${deliveryMetrics.successRate}%` },
        { label: tr("失败", "Failed"), value: deliveryMetrics.failed24h.toLocaleString() },
        { label: tr("P95 时延", "P95 Latency"), value: `${deliveryMetrics.p95LatencyMs}ms` },
      ]} />
      <Card className="mb-6 p-5">
        <div className="mb-3 text-sm font-semibold text-gray-900">{tr("事件量趋势", "Event Volume Trend")}</div>
        <Sparkline data={deliveryMetrics.series} height={80} />
      </Card>
      <Card className="p-2">
        <div className="px-3 pt-3 text-sm font-semibold text-gray-900">{tr("数据源健康", "Source Health")}</div>
        <DataTable
          columns={[COL.source, COL.events, COL.errorRate, COL.status]}
          rows={sourcesHealth.map((s) => ({
            [COL.source]: s.source,
            [COL.events]: s.events24h.toLocaleString(),
            [COL.errorRate]: s.errorRate,
            [COL.status]: s.status,
          }))}
        />
      </Card>
    </Layout>
  );
}
