import Layout from "../../components/layout/Layout";
import { DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { reverseEtl } from "../../mock/data";

export default function ReverseEtlPage() {
  const rows = reverseEtl.map((r) => ({
    任务: r.name,
    数据源: r.source,
    调度: r.schedule,
    同步行数: r.records.toLocaleString(),
    状态: r.status,
  }));

  return (
    <Layout
      title="反向 ETL Reverse ETL"
      subtitle="将数仓宽表/对象按调度反向同步到飞书、广告平台等目的地"
      actions={<MockTag />}
    >
      <StatCards items={[
        { label: "总任务数", value: reverseEtl.length },
        { label: "运行中", value: reverseEtl.filter((r) => r.status === "运行中").length },
        { label: "已暂停", value: reverseEtl.filter((r) => r.status === "已暂停").length },
        { label: "近期同步行数", value: reverseEtl.reduce((a, r) => a + r.records, 0).toLocaleString() },
      ]} />
      <DataTable columns={["任务", "数据源", "调度", "同步行数", "状态"]} rows={rows} />
    </Layout>
  );
}
