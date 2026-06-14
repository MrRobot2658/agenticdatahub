import { useEffect, useState } from "react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Badge } from "../components/ui";
import { listSegments } from "../api/client";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";

export default function SegmentsPage() {
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
    <Layout title={tr("用户群组", "User Groups")}>
      <div className="mb-5 flex items-center gap-2">
        <p className="text-sm text-gray-500">{tr("已保存的人群包 / Segment（来自 /segments）", "Saved segments (from /segments)")}</p>
        {rows && <Badge color="brand">{rows.length} {tr("个", "")}</Badge>}
      </div>
      {err && <Card className="p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}
      {rows && (
        <Card className="p-2">
          <DataTable columns={cols} rows={rows} />
        </Card>
      )}
    </Layout>
  );
}
