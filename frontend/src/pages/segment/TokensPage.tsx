import { Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable } from "../../components/ui";
import { MockTag, SubTabs } from "../../components/segment/kit";
import { apiTokens } from "../../mock/data";

const TABS = [
  { label: "通用", to: "/settings" },
  { label: "权限管理", to: "/settings/access" },
  { label: "API 令牌", to: "/settings/tokens" },
  { label: "审计日志", to: "/settings/audit" },
];

export default function TokensPage() {
  const rows = apiTokens.map((t) => ({
    名称: t.label, 令牌: t.prefix, 权限: t.scopes, 创建时间: t.created, 最近使用: t.lastUsed,
  }));

  return (
    <Layout
      title="API 令牌 API Tokens"
      subtitle="服务端访问凭证与权限范围"
      actions={<><MockTag /><Button><Plus className="h-4 w-4" /> 生成令牌</Button></>}
    >
      <SubTabs tabs={TABS.map((t) => ({ ...t, active: t.label === "API 令牌" }))} />
      <Card className="p-2">
        <DataTable columns={["名称", "令牌", "权限", "创建时间", "最近使用"]} rows={rows} />
      </Card>
    </Layout>
  );
}
