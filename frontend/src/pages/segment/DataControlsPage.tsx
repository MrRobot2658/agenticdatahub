import Layout from "../../components/layout/Layout";
import { Card, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { piiFields } from "../../mock/data";
import { useLang } from "../../context/LangContext";

export default function DataControlsPage() {
  const { tr } = useLang();
  const COL = {
    field: tr("字段", "Field"),
    category: tr("类别", "Category"),
    detected: tr("检测方式", "Detection"),
    action: tr("处理动作", "Action"),
    scope: tr("范围", "Scope"),
  };
  return (
    <Layout
      title={tr("数据管控 Data Controls", "Data Controls")}
      subtitle={tr("检测与管控 PII / 敏感字段，按字段配置哈希、阻断或明文动作", "Detect and control PII / sensitive fields, configuring hash, block, or plaintext actions per field")}
      actions={<MockTag />}
    >
      <StatCards items={[
        { label: tr("受管字段", "Managed Fields"), value: piiFields.length },
        { label: tr("自动检测", "Auto-detected"), value: piiFields.filter((f) => f.detected === "自动").length },
        { label: tr("阻断数", "Blocked"), value: piiFields.filter((f) => f.action === "阻断").length },
        { label: tr("明文放行", "Plaintext Allowed"), value: piiFields.filter((f) => f.action === "明文").length },
      ]} />
      <Card className="p-2">
        <DataTable
          columns={[COL.field, COL.category, COL.detected, COL.action, COL.scope]}
          rows={piiFields.map((f) => ({
            [COL.field]: f.field,
            [COL.category]: f.category,
            [COL.detected]: f.detected,
            [COL.action]: f.action,
            [COL.scope]: f.scope,
          }))}
        />
      </Card>
    </Layout>
  );
}
