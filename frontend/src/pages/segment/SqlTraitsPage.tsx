import { Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Button, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { sqlTraits } from "../../mock/data";

export default function SqlTraitsPage() {
  const warehouses = new Set(sqlTraits.map((t) => t.warehouse));
  const coverage = sqlTraits.reduce((a, t) => a + t.rows, 0);
  return (
    <Layout
      title="SQL 特征 SQL Traits"
      subtitle="用 SQL 在数据仓库内计算并回填用户特征"
      actions={<><MockTag /><Button><Plus className="h-4 w-4" /> 新建 SQL 特征</Button></>}
    >
      <StatCards items={[
        { label: "特征数", value: sqlTraits.length },
        { label: "数仓数", value: warehouses.size },
        { label: "覆盖用户", value: coverage },
      ]} />
      <Card className="p-2">
        <DataTable
          columns={["特征", "数据仓库", "调度", "最近运行", "命中行数"]}
          rows={sqlTraits.map((t) => ({
            "特征": t.name,
            "数据仓库": t.warehouse,
            "调度": t.schedule,
            "最近运行": t.lastRun,
            "命中行数": t.rows,
          }))}
        />
      </Card>
    </Layout>
  );
}
