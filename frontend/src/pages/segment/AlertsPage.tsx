import { Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Button, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { alerts } from "../../mock/data";

export default function AlertsPage() {
  return (
    <Layout
      title="告警 Alerts"
      subtitle="为投递成功率、事件量与违规设置阈值，触发即通知"
      actions={<><MockTag /><Button><Plus className="h-4 w-4" /> 新建告警</Button></>}
    >
      <StatCards items={[
        { label: "告警规则", value: alerts.length },
        { label: "已触发", value: alerts.filter((a) => a.status === "已触发").length },
      ]} />
      <Card className="p-2">
        <DataTable
          columns={["规则", "通知渠道", "范围", "状态", "最近触发"]}
          rows={alerts.map((a) => ({
            "规则": a.name,
            "通知渠道": a.channel,
            "范围": a.scope,
            "状态": a.status,
            "最近触发": a.last,
          }))}
        />
      </Card>
    </Layout>
  );
}
