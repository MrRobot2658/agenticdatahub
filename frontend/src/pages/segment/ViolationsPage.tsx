import Layout from "../../components/layout/Layout";
import { DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { violations } from "../../mock/data";

export default function ViolationsPage() {
  const rows = violations.map((v) => ({
    事件: v.event,
    问题: v.issue,
    出现次数: v.count.toLocaleString(),
    数据源: v.source,
    级别: v.severity === "high" ? "高" : "低",
  }));
  return (
    <Layout
      title="数据质量违规 Violations"
      subtitle="上报与埋点计划不符的事件，及时发现并修复数据质量问题"
      actions={<MockTag />}
    >
      <StatCards items={[
        { label: "违规类型", value: violations.length },
        { label: "受影响事件", value: violations.reduce((a, v) => a + v.count, 0).toLocaleString() },
        { label: "高危", value: violations.filter((v) => v.severity === "high").length },
      ]} />
      <DataTable columns={["事件", "问题", "出现次数", "数据源", "级别"]} rows={rows} />
    </Layout>
  );
}
