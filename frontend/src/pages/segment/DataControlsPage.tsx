import Layout from "../../components/layout/Layout";
import { Card, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { piiFields } from "../../mock/data";

export default function DataControlsPage() {
  return (
    <Layout
      title="数据管控 Data Controls"
      subtitle="检测与管控 PII / 敏感字段，按字段配置哈希、阻断或明文动作"
      actions={<MockTag />}
    >
      <StatCards items={[
        { label: "受管字段", value: piiFields.length },
        { label: "自动检测", value: piiFields.filter((f) => f.detected === "自动").length },
        { label: "阻断数", value: piiFields.filter((f) => f.action === "阻断").length },
        { label: "明文放行", value: piiFields.filter((f) => f.action === "明文").length },
      ]} />
      <Card className="p-2">
        <DataTable
          columns={["字段", "类别", "检测方式", "处理动作", "范围"]}
          rows={piiFields.map((f) => ({
            "字段": f.field,
            "类别": f.category,
            "检测方式": f.detected,
            "处理动作": f.action,
            "范围": f.scope,
          }))}
        />
      </Card>
    </Layout>
  );
}
