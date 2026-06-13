import Layout from "../../components/layout/Layout";
import { Card, DataTable } from "../../components/ui";
import { MockTag, SubTabs } from "../../components/segment/kit";
import { auditTrail } from "../../mock/data";

const TABS = [
  { label: "通用", to: "/settings" },
  { label: "权限管理", to: "/settings/access" },
  { label: "API 令牌", to: "/settings/tokens" },
  { label: "审计日志", to: "/settings/audit" },
];

export default function AuditPage() {
  const rows = auditTrail.map((a) => ({
    时间: a.time, 操作者: a.actor, 动作: a.action, 对象: a.target,
  }));

  return (
    <Layout title="审计日志 Audit Trail" subtitle="工作区内的关键操作记录" actions={<MockTag />}>
      <SubTabs tabs={TABS.map((t) => ({ ...t, active: t.label === "审计日志" }))} />
      <Card className="p-2">
        <DataTable columns={["时间", "操作者", "动作", "对象"]} rows={rows} />
      </Card>
    </Layout>
  );
}
