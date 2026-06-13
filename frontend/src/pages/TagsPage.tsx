import { useEffect, useState } from "react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner } from "../components/ui";
import { listTags } from "../api/client";
import { useTenant } from "../context/TenantContext";

export default function TagsPage() {
  const { tenant } = useTenant();
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(null); setErr(null);
    listTags(tenant).then(setRows).catch((e) => setErr(String(e)));
  }, [tenant]);

  return (
    <Layout
      title="计算特征 Computed Traits"
      subtitle="基于用户行为/属性计算的标签体系与覆盖人数（来自 /tags）"
    >
      {err && <Card className="p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> 加载中…</div>}
      {rows && (
        <Card className="p-2">
          <DataTable columns={rows[0] ? Object.keys(rows[0]) : ["tag"]} rows={rows} />
        </Card>
      )}
    </Layout>
  );
}
