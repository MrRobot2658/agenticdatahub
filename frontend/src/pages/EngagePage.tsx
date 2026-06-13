import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Boxes } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Button, Badge } from "../components/ui";
import { listSegments } from "../api/client";
import { useTenant } from "../context/TenantContext";

// Engage › Audiences —— 已保存的人群包（来自 /segments），对标 Segment 受众列表。
export default function EngagePage() {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(null); setErr(null);
    listSegments(tenant).then(setRows).catch((e) => setErr(String(e)));
  }, [tenant]);

  const cols = rows?.[0]
    ? Object.keys(rows[0]).filter((k) => k !== "dsl").slice(0, 8)
    : ["segment_code"];

  return (
    <Layout
      title="受众 Audiences"
      subtitle="用统一档案圈选人群，保存为可激活的受众"
      actions={
        <Link to="/engage/audiences/new">
          <Button><Plus className="h-4 w-4" /> 创建受众</Button>
        </Link>
      }
    >
      {err && <Card className="p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}

      {rows && rows.length === 0 && (
        <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Boxes className="h-6 w-6" />
          </div>
          <div className="font-semibold text-gray-900">还没有受众</div>
          <div className="max-w-sm text-sm text-gray-500">在筛选器里圈选一组用户并「存为群组」，就会出现在这里。</div>
          <Link to="/engage/audiences/new"><Button><Plus className="h-4 w-4" /> 创建第一个受众</Button></Link>
        </Card>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="mb-3 flex items-center gap-2 text-sm text-gray-500">
            共 <Badge color="brand">{rows.length}</Badge> 个受众
          </div>
          <Card className="p-2">
            <DataTable columns={cols} rows={rows} />
          </Card>
        </>
      )}
    </Layout>
  );
}
