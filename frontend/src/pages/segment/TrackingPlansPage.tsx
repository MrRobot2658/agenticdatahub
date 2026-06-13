import Layout from "../../components/layout/Layout";
import { Card, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { trackingPlans, trackingEvents } from "../../mock/data";

export default function TrackingPlansPage() {
  const avg = Math.round(
    trackingPlans.reduce((a, p) => a + parseInt(p.conformance), 0) / trackingPlans.length
  );
  return (
    <Layout
      title="埋点计划 Tracking Plans"
      subtitle="校验事件 schema、治理数据质量，确保上报符合规范"
      actions={<MockTag />}
    >
      <StatCards items={[
        { label: "埋点计划数", value: trackingPlans.length },
        { label: "事件总数", value: trackingPlans.reduce((a, p) => a + p.events, 0) },
        { label: "平均合规率", value: `${avg}%` },
      ]} />
      <Card className="mb-6 p-2">
        <DataTable
          columns={["计划", "事件数", "数据源", "合规率", "更新"]}
          rows={trackingPlans.map((p) => ({
            计划: p.name, 事件数: p.events, 数据源: p.sources, 合规率: p.conformance, 更新: p.updated,
          }))}
        />
      </Card>
      <h2 className="mb-3 text-sm font-semibold text-gray-900">事件 Schema（电商核心埋点）</h2>
      <Card className="p-2">
        <DataTable
          columns={["事件", "类型", "属性数", "必填", "状态"]}
          rows={trackingEvents.map((e) => ({
            事件: e.event, 类型: e.type, 属性数: e.properties, 必填: e.required, 状态: e.status,
          }))}
        />
      </Card>
    </Layout>
  );
}
