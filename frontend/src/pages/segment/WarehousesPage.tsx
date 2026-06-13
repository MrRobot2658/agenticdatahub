import { Database, Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button } from "../../components/ui";
import { Catalog, StatCards, MockTag, type CatalogItem } from "../../components/segment/kit";
import { warehouses } from "../../mock/data";

export default function WarehousesPage() {
  const items: CatalogItem[] = warehouses.map((w) => ({
    icon: Database,
    name: w.name,
    term: w.type,
    desc: `${w.region} · 最近同步 ${w.lastSync}`,
    status: w.status === "健康"
      ? { tone: "green" as const, label: "健康" }
      : { tone: "gray" as const, label: "未连接" },
  }));

  return (
    <Layout
      title="数据仓库 Warehouses"
      subtitle="将 Profiles、事件与受众同步落库到 OLAP / 业务库"
      actions={<><MockTag /><Button><Plus className="h-4 w-4" /> 连接数据仓库</Button></>}
    >
      <StatCards items={[
        { label: "数据仓库", value: warehouses.length },
        { label: "健康", value: warehouses.filter((w) => w.status === "健康").length },
        { label: "未连接", value: warehouses.filter((w) => w.status === "未连接").length },
        { label: "区域", value: new Set(warehouses.map((w) => w.region)).size },
      ]} />
      <Catalog items={items} columns={3} />
    </Layout>
  );
}
