import Layout from "../../components/layout/Layout";
import { Card } from "../../components/ui";
import { MockTag, SubTabs } from "../../components/segment/kit";
import { workspaceInfo } from "../../mock/data";

const TABS = [
  { label: "通用", to: "/settings" },
  { label: "权限管理", to: "/settings/access" },
  { label: "API 令牌", to: "/settings/tokens" },
  { label: "审计日志", to: "/settings/audit" },
];

export default function SettingsGeneralPage() {
  const rows: { k: string; v: string }[] = [
    { k: "名称", v: workspaceInfo.name },
    { k: "标识 slug", v: workspaceInfo.slug },
    { k: "区域", v: workspaceInfo.region },
    { k: "套餐 plan", v: workspaceInfo.plan },
    { k: "创建时间", v: workspaceInfo.created },
    { k: "租户", v: workspaceInfo.tenants.join(", ") },
  ];

  return (
    <Layout title="通用 General" subtitle="工作区基本信息与归属租户" actions={<MockTag />}>
      <SubTabs tabs={TABS.map((t) => ({ ...t, active: t.label === "通用" }))} />
      <Card className="p-6">
        <div className="mb-4 text-base font-semibold text-gray-900">工作区 Workspace</div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.k} className="flex justify-between gap-4 border-b border-gray-100 py-2">
              <dt className="text-sm text-gray-500">{r.k}</dt>
              <dd className="text-sm font-medium text-gray-900">{r.v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </Layout>
  );
}
