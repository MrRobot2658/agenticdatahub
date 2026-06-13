import Layout from "../../components/layout/Layout";
import { Card, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { identityRules } from "../../mock/data";

export default function IdentityResolutionPage() {
  const uniqueCount = identityRules.filter((r) => r.isUnique).length;
  return (
    <Layout
      title="身份识别 Identity Resolution"
      subtitle="将各渠道标识符实时识别并 merge 到统一 one_id"
      actions={<MockTag />}
    >
      <StatCards items={[
        { label: "标识符数", value: identityRules.length },
        { label: "唯一标识数", value: uniqueCount },
        { label: "merge 策略", value: "实时" },
      ]} />
      <Card className="p-2">
        <DataTable
          columns={["标识符", "上限", "唯一性", "说明"]}
          rows={identityRules.map((r) => ({
            "标识符": r.identifier,
            "上限": r.limit,
            "唯一性": r.isUnique ? "唯一" : "非唯一",
            "说明": r.note,
          }))}
        />
      </Card>
    </Layout>
  );
}
