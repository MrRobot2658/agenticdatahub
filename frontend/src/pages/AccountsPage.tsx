import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GitMerge } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Badge } from "../components/ui";
import { listAccounts } from "../api/accounts";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";

// 客户管理 —— 客户(account)列表，一个客户可含多个用户。点击行进入客户详情。
const scaleLabel = (tr: (zh: string, en: string) => string): Record<string, string> => ({
  large: tr("大型", "Large"),
  medium: tr("中型", "Medium"),
  small: tr("小型", "Small"),
});

export default function AccountsPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const SCALE = scaleLabel(tr);
  const COL = {
    id: tr("客户ID", "Account ID"),
    name: tr("名称", "Name"),
    industry: tr("行业", "Industry"),
    scale: tr("规模", "Scale"),
  };
  const [rows, setRows] = useState<Record<string, any>[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(null); setErr(null);
    listAccounts(tenant, 200)
      .then((r) => setRows(r.data || []))
      .catch((e) => setErr(String(e)));
  }, [tenant]);

  const view = (rows || []).map((r) => ({
    [COL.id]: r.account_id,
    [COL.name]: r.name,
    [COL.industry]: r.industry,
    [COL.scale]: SCALE[r.scale] ?? r.scale,
    _id: r.account_id,
  }));

  return (
    <Layout
      title={tr("客户 Accounts", "Accounts")}
      subtitle={tr("客户（账户）主数据 —— 一个客户可关联多个用户；点击客户查看其用户", "Account master data — one account can be linked to multiple users; click an account to view its users")}
      actions={
        <div className="flex items-center gap-3">
          {rows && <Badge color="brand">{tr(`${rows.length} 个客户`, `${rows.length} accounts`)}</Badge>}
          <Link to="/accounts/-/merge-log" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600">
            <GitMerge className="h-4 w-4" /> {tr("合并日志", "Merge log")}
          </Link>
        </div>
      }
    >
      {err && <Card className="p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}
      {rows && (
        <Card className="p-2">
          <div className="px-3 pb-2 pt-3 text-sm font-semibold text-gray-700">
            {tr("客户列表", "Account list")} <span className="ml-2 font-normal text-gray-400">· {tr("点击行查看详情", "Click a row for details")}</span>
          </div>
          <DataTable
            columns={[COL.id, COL.name, COL.industry, COL.scale]}
            rows={view}
            rowLink={(r) => `/accounts/${r._id}`}
          />
        </Card>
      )}
    </Layout>
  );
}
