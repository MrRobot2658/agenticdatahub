import Layout from "../../components/layout/Layout";
import { Card, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { consentCategories } from "../../mock/data";

export default function ConsentPage() {
  return (
    <Layout
      title="同意管理 Consent"
      subtitle="管理同意分类与厂商映射，控制数据可流向的目的地"
      actions={<MockTag />}
    >
      <StatCards items={[
        { label: "同意分类数", value: consentCategories.length },
        { label: "必选类", value: consentCategories.filter((c) => c.required).length },
        { label: "厂商总数", value: consentCategories.reduce((a, c) => a + c.vendors, 0) },
        { label: "可选类", value: consentCategories.filter((c) => !c.required).length },
      ]} />
      <Card className="p-2">
        <DataTable
          columns={["分类", "是否必选", "同意率", "厂商数"]}
          rows={consentCategories.map((c) => ({
            "分类": c.category,
            "是否必选": c.required ? "必选" : "可选",
            "同意率": c.optedIn,
            "厂商数": c.vendors,
          }))}
        />
      </Card>
    </Layout>
  );
}
