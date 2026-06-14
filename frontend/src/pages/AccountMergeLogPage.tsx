import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Badge } from "../components/ui";
import { listAllMergeLog, type MergeLogEntry } from "../api/accounts";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";

// 客户合并日志（租户全量）—— 读 /accounts/-/merge-log

export default function AccountMergeLogPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [rows, setRows] = useState<MergeLogEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const ACTION: Record<string, string> = {
    merge: tr("合并", "Merge"),
    dedup: tr("去重", "Dedup"),
    unmerge: tr("拆分", "Unmerge"),
  };

  const COL = {
    action: tr("动作", "Action"),
    master: tr("主账户", "Master Account"),
    merged: tr("被合并账户", "Merged Account"),
    users: tr("用户数", "Users"),
    operator: tr("操作人", "Operator"),
    time: tr("时间", "Time"),
  };

  useEffect(() => {
    setRows(null); setErr(null);
    listAllMergeLog(tenant, 200)
      .then(setRows)
      .catch((e) => setErr(String(e)));
  }, [tenant]);

  const view = (rows || []).map((m) => ({
    [COL.action]: ACTION[m.action] ?? m.action,
    [COL.master]: m.master_account_id,
    [COL.merged]: m.merged_account_id,
    [COL.users]: m.user_count ?? "—",
    [COL.operator]: m.created_by ?? "—",
    [COL.time]: m.created_at ?? "—",
    _id: m.master_account_id,
  }));

  return (
    <Layout
      title={tr("客户合并日志", "Account Merge Log")}
      subtitle={tr("Account Merge Log · 租户全量账户合并 / 去重 / 拆分审计", "Tenant-wide account merge / dedup / unmerge audit")}
      actions={
        <div className="flex items-center gap-3">
          {rows && <Badge color="brand">{tr(`${rows.length} 条`, `${rows.length} entries`)}</Badge>}
          <Link to="/accounts" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600">
            <ArrowLeft className="h-4 w-4" /> {tr("返回客户列表", "Back to Accounts")}
          </Link>
        </div>
      }
    >
      {err && <Card className="p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}
      {rows && (
        <Card className="p-2">
          <DataTable
            columns={[COL.action, COL.master, COL.merged, COL.users, COL.operator, COL.time]}
            rows={view}
            rowLink={(r) => `/accounts/${r._id}`}
          />
        </Card>
      )}
    </Layout>
  );
}
