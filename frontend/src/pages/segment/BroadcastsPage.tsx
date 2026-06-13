import { Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { broadcasts } from "../../mock/data";

export default function BroadcastsPage() {
  const rows = broadcasts.map((b) => ({
    名称: b.name,
    渠道: b.channel,
    受众: b.audience,
    发送量: b.sent.toLocaleString(),
    打开率: b.openRate,
    日期: b.date,
  }));
  return (
    <Layout
      title="群发 Broadcasts"
      subtitle="面向受众的一次性群发触达，支持 Push、短信与 EDM"
      actions={<><MockTag /><Button><Plus className="h-4 w-4" /> 新建群发</Button></>}
    >
      <StatCards items={[
        { label: "群发次数", value: broadcasts.length },
        { label: "总触达", value: broadcasts.reduce((a, b) => a + b.sent, 0).toLocaleString() },
      ]} />
      <DataTable columns={["名称", "渠道", "受众", "发送量", "打开率", "日期"]} rows={rows} />
    </Layout>
  );
}
