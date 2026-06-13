import Layout from "../../components/layout/Layout";
import { Card, DataTable } from "../../components/ui";
import { StatCards, MockTag, Sparkline } from "../../components/segment/kit";
import { deliveryMetrics, sourcesHealth } from "../../mock/data";

export default function DeliveryPage() {
  return (
    <Layout
      title="投递概览 Delivery Overview"
      subtitle="实时监控事件投递吞吐、成功率与各数据源健康度"
      actions={<MockTag />}
    >
      <StatCards items={[
        { label: "近24h事件", value: deliveryMetrics.events24h.toLocaleString() },
        { label: "成功率", value: `${deliveryMetrics.successRate}%` },
        { label: "失败", value: deliveryMetrics.failed24h.toLocaleString() },
        { label: "P95 时延", value: `${deliveryMetrics.p95LatencyMs}ms` },
      ]} />
      <Card className="mb-6 p-5">
        <div className="mb-3 text-sm font-semibold text-gray-900">事件量趋势</div>
        <Sparkline data={deliveryMetrics.series} height={80} />
      </Card>
      <Card className="p-2">
        <div className="px-3 pt-3 text-sm font-semibold text-gray-900">数据源健康</div>
        <DataTable
          columns={["数据源", "近24h事件", "错误率", "状态"]}
          rows={sourcesHealth.map((s) => ({
            "数据源": s.source,
            "近24h事件": s.events24h.toLocaleString(),
            "错误率": s.errorRate,
            "状态": s.status,
          }))}
        />
      </Card>
    </Layout>
  );
}
