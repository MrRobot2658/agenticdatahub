import { Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Button, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { deletionRequests } from "../../mock/data";

export default function DeletionPage() {
  return (
    <Layout
      title="数据删除 Deletion"
      subtitle="处理 GDPR 删除与抑制请求，跟踪每个数据主体的处理进度"
      actions={<><MockTag /><Button><Plus className="h-4 w-4" /> 新建删除请求</Button></>}
    >
      <StatCards items={[
        { label: "请求总数", value: deletionRequests.length },
        { label: "处理中", value: deletionRequests.filter((r) => r.status === "处理中").length },
        { label: "已完成", value: deletionRequests.filter((r) => r.status === "已完成").length },
      ]} />
      <Card className="p-2">
        <DataTable
          columns={["请求ID", "主体", "类型", "提交时间", "状态"]}
          rows={deletionRequests.map((r) => ({
            "请求ID": r.id,
            "主体": r.subject,
            "类型": r.type,
            "提交时间": r.requested,
            "状态": r.status,
          }))}
        />
      </Card>
    </Layout>
  );
}
