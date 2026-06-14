import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Boxes } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Button, Badge } from "../components/ui";
import { listSegments } from "../api/client";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";

// Engage › Audiences —— 已保存的人群包（来自 /segments），对标 Segment 受众列表。
export default function EngagePage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
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
      title={tr("受众 Audiences", "Audiences")}
      subtitle={tr("用统一档案圈选人群，保存为可激活的受众", "Build audiences from unified profiles and save them for activation")}
      actions={
        <Link to="/engage/audiences/new">
          <Button><Plus className="h-4 w-4" /> {tr("创建受众", "Create Audience")}</Button>
        </Link>
      }
    >
      {err && <Card className="p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {rows && rows.length === 0 && (
        <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Boxes className="h-6 w-6" />
          </div>
          <div className="font-semibold text-gray-900">{tr("还没有受众", "No audiences yet")}</div>
          <div className="max-w-sm text-sm text-gray-500">{tr("在筛选器里圈选一组用户并「存为群组」，就会出现在这里。", "Select a group of users in the filter and “Save as Group” to see them here.")}</div>
          <Link to="/engage/audiences/new"><Button><Plus className="h-4 w-4" /> {tr("创建第一个受众", "Create your first audience")}</Button></Link>
        </Card>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="mb-3 flex items-center gap-2 text-sm text-gray-500">
            {tr("共", "Total")} <Badge color="brand">{rows.length}</Badge> {tr("个受众", "audiences")}
          </div>
          <Card className="p-2">
            <DataTable columns={cols} rows={rows} />
          </Card>
        </>
      )}
    </Layout>
  );
}
