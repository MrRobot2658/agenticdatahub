import { UserPlus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable } from "../../components/ui";
import { MockTag, StatCards, SubTabs } from "../../components/segment/kit";
import { iamUsers, roles } from "../../mock/data";

const TABS = [
  { label: "通用", to: "/settings" },
  { label: "权限管理", to: "/settings/access" },
  { label: "API 令牌", to: "/settings/tokens" },
  { label: "审计日志", to: "/settings/audit" },
];

export default function AccessPage() {
  const userRows = iamUsers.map((u) => ({
    成员: u.name, 邮箱: u.email, 角色: u.role, 团队: u.teams, 状态: u.status,
  }));
  const roleRows = roles.map((r) => ({ 角色: r.role, 成员数: r.members, 权限范围: r.scope }));

  return (
    <Layout
      title="权限管理 Access Management"
      subtitle="成员、角色与权限范围"
      actions={<><MockTag /><Button><UserPlus className="h-4 w-4" /> 邀请成员</Button></>}
    >
      <SubTabs tabs={TABS.map((t) => ({ ...t, active: t.label === "权限管理" }))} />
      <StatCards items={[
        { label: "成员数", value: iamUsers.length },
        { label: "角色数", value: roles.length },
        { label: "活跃", value: iamUsers.filter((u) => u.status === "活跃").length },
      ]} />
      <Card className="mb-6 p-2">
        <DataTable columns={["成员", "邮箱", "角色", "团队", "状态"]} rows={userRows} />
      </Card>
      <div className="mb-3 text-base font-semibold text-gray-900">角色 Roles</div>
      <Card className="p-2">
        <DataTable columns={["角色", "成员数", "权限范围"]} rows={roleRows} />
      </Card>
    </Layout>
  );
}
