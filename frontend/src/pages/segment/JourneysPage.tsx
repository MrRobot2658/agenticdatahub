import { Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { journeys } from "../../mock/data";

export default function JourneysPage() {
  const rows = journeys.map((j) => ({
    旅程: j.name,
    步骤数: j.steps,
    进行中人数: j.inJourney.toLocaleString(),
    转化率: j.conversion,
    状态: j.status,
  }));
  return (
    <Layout
      title="旅程 Journeys"
      subtitle="编排多步骤的用户自动化旅程，按条件分流与触达"
      actions={<><MockTag /><Button><Plus className="h-4 w-4" /> 新建旅程</Button></>}
    >
      <StatCards items={[
        { label: "旅程数", value: journeys.length },
        { label: "运行中", value: journeys.filter((j) => j.status === "运行中").length },
        { label: "进行中用户", value: journeys.reduce((a, j) => a + j.inJourney, 0).toLocaleString() },
      ]} />
      <DataTable columns={["旅程", "步骤数", "进行中人数", "转化率", "状态"]} rows={rows} />
    </Layout>
  );
}
