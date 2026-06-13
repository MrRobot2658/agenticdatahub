import { FunctionSquare, Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button } from "../../components/ui";
import { Catalog, StatCards, MockTag, type CatalogItem } from "../../components/segment/kit";
import { functions } from "../../mock/data";

export default function FunctionsPage() {
  const items: CatalogItem[] = functions.map((f) => ({
    icon: FunctionSquare,
    name: f.name,
    term: f.type,
    desc: `${f.lang} · 近7天 ${f.runs7d.toLocaleString()} 次执行 · ${f.errors} 错误`,
    status: f.status === "已部署"
      ? { tone: "green" as const, label: "已部署" }
      : { tone: "gray" as const, label: "草稿" },
  }));

  return (
    <Layout
      title="Functions"
      subtitle="用自定义代码在数据源/目的地侧转换数据"
      actions={<><MockTag /><Button><Plus className="h-4 w-4" /> 新建 Function</Button></>}
    >
      <StatCards items={[
        { label: "已部署", value: functions.filter((f) => f.status === "已部署").length },
        { label: "近7天执行", value: functions.reduce((a, f) => a + f.runs7d, 0).toLocaleString() },
        { label: "错误", value: functions.reduce((a, f) => a + f.errors, 0) },
        { label: "草稿", value: functions.filter((f) => f.status === "草稿").length },
      ]} />
      <Catalog items={items} />
    </Layout>
  );
}
