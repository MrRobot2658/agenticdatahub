import { Plus } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Button, DataTable } from "../../components/ui";
import { MockTag } from "../../components/segment/kit";
import { profilesSync } from "../../mock/data";

export default function ProfilesSyncPage() {
  return (
    <Layout
      title="档案同步 Profiles Sync"
      subtitle="将统一档案持续同步回数据仓库，供下游分析使用"
      actions={<><MockTag /><Button><Plus className="h-4 w-4" /> 新建同步</Button></>}
    >
      <Card className="p-2">
        <DataTable
          columns={["数据仓库", "同步表", "调度", "状态"]}
          rows={profilesSync.map((s) => ({
            "数据仓库": s.warehouse,
            "同步表": s.tables,
            "调度": s.schedule,
            "状态": s.status,
          }))}
        />
      </Card>
    </Layout>
  );
}
