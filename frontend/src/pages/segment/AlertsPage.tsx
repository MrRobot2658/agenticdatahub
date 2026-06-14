import { Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Button, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { alerts } from "../../mock/data";
import { useLang } from "../../context/LangContext";

export default function AlertsPage() {
  const { tr } = useLang();
  const COL = {
    rule: tr("规则", "Rule"),
    channel: tr("通知渠道", "Notification Channel"),
    scope: tr("范围", "Scope"),
    status: tr("状态", "Status"),
    last: tr("最近触发", "Last Triggered"),
  };
  return (
    <Layout
      title={tr("告警 Alerts", "Alerts")}
      subtitle={tr("为投递成功率、事件量与违规设置阈值，触发即通知", "Set thresholds for delivery success rate, event volume and violations, and get notified on trigger")}
      actions={<><MockTag /><Button><Plus className="h-4 w-4" /> {tr("新建告警", "New Alert")}</Button></>}
    >
      <StatCards items={[
        { label: tr("告警规则", "Alert Rules"), value: alerts.length },
        { label: tr("已触发", "Triggered"), value: alerts.filter((a) => a.status === "已触发").length },
      ]} />
      <Card className="p-2">
        <DataTable
          columns={[COL.rule, COL.channel, COL.scope, COL.status, COL.last]}
          rows={alerts.map((a) => ({
            [COL.rule]: a.name,
            [COL.channel]: a.channel,
            [COL.scope]: a.scope,
            [COL.status]: a.status,
            [COL.last]: a.last,
          }))}
        />
      </Card>
    </Layout>
  );
}
