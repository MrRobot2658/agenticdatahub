import { Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Button, DataTable } from "../../components/ui";
import { StatCards, MockTag } from "../../components/segment/kit";
import { deletionRequests } from "../../mock/data";
import { useLang } from "../../context/LangContext";

export default function DeletionPage() {
  const { tr } = useLang();
  const COL = {
    id: tr("请求ID", "Request ID"),
    subject: tr("主体", "Subject"),
    type: tr("类型", "Type"),
    requested: tr("提交时间", "Submitted"),
    status: tr("状态", "Status"),
  };
  return (
    <Layout
      title={tr("数据删除 Deletion", "Deletion")}
      subtitle={tr("处理 GDPR 删除与抑制请求，跟踪每个数据主体的处理进度", "Handle GDPR deletion and suppression requests, and track the progress for each data subject")}
      actions={<><MockTag /><Button><Plus className="h-4 w-4" /> {tr("新建删除请求", "New deletion request")}</Button></>}
    >
      <StatCards items={[
        { label: tr("请求总数", "Total requests"), value: deletionRequests.length },
        { label: tr("处理中", "In progress"), value: deletionRequests.filter((r) => r.status === "处理中").length },
        { label: tr("已完成", "Completed"), value: deletionRequests.filter((r) => r.status === "已完成").length },
      ]} />
      <Card className="p-2">
        <DataTable
          columns={[COL.id, COL.subject, COL.type, COL.requested, COL.status]}
          rows={deletionRequests.map((r) => ({
            [COL.id]: r.id,
            [COL.subject]: r.subject,
            [COL.type]: r.type,
            [COL.requested]: r.requested,
            [COL.status]: r.status,
          }))}
        />
      </Card>
    </Layout>
  );
}
