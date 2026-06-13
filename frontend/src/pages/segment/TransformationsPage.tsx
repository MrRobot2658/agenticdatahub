import { Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { transformations } from "../../mock/data";

export default function TransformationsPage() {
  const rows = transformations.map((t) => ({
    转换: t.name,
    作用范围: t.scope,
    类型: t.type,
    状态: t.status,
  }));
  return (
    <Layout
      title="数据转换 Transformations"
      subtitle="在事件入库前对其做重命名/删除/映射，统一下游数据口径"
      actions={<><MockTag /><Button><Plus className="h-4 w-4" /> 新建转换</Button></>}
    >
      <StatCards items={[
        { label: "转换数", value: transformations.length },
        { label: "启用", value: transformations.filter((t) => t.status === "启用").length },
        { label: "停用", value: transformations.filter((t) => t.status === "停用").length },
      ]} />
      <DataTable columns={["转换", "作用范围", "类型", "状态"]} rows={rows} />
    </Layout>
  );
}
