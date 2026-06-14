import Layout from "../../components/layout/Layout";
import { Card, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { consentCategories } from "../../mock/data";
import { useLang } from "../../context/LangContext";

export default function ConsentPage() {
  const { tr } = useLang();
  const COL = {
    category: tr("分类", "Category"),
    required: tr("是否必选", "Required"),
    optedIn: tr("同意率", "Opt-in Rate"),
    vendors: tr("厂商数", "Vendors"),
  };
  return (
    <Layout
      title={tr("同意管理 Consent", "Consent")}
      subtitle={tr("管理同意分类与厂商映射，控制数据可流向的目的地", "Manage consent categories and vendor mappings to control where data can flow")}
      actions={<MockTag />}
    >
      <StatCards items={[
        { label: tr("同意分类数", "Consent Categories"), value: consentCategories.length },
        { label: tr("必选类", "Required"), value: consentCategories.filter((c) => c.required).length },
        { label: tr("厂商总数", "Total Vendors"), value: consentCategories.reduce((a, c) => a + c.vendors, 0) },
        { label: tr("可选类", "Optional"), value: consentCategories.filter((c) => !c.required).length },
      ]} />
      <Card className="p-2">
        <DataTable
          columns={[COL.category, COL.required, COL.optedIn, COL.vendors]}
          rows={consentCategories.map((c) => ({
            [COL.category]: c.category,
            [COL.required]: c.required ? tr("必选", "Required") : tr("可选", "Optional"),
            [COL.optedIn]: c.optedIn,
            [COL.vendors]: c.vendors,
          }))}
        />
      </Card>
    </Layout>
  );
}
