import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Users, Building2, GitMerge } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Badge } from "../components/ui";
import { StatCards } from "../components/segment/kit";
import {
  getAccount,
  listAccountUsers,
  listAccountMergeLog,
  type AccountDetail,
  type MergeLogEntry,
} from "../api/accounts";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";

type Tr = (zh: string, en: string) => string;

function scaleLabel(tr: Tr, code?: string | null) {
  const map: Record<string, string> = {
    large: tr("大型", "Large"),
    medium: tr("中型", "Medium"),
    small: tr("小型", "Small"),
  };
  return (code && map[code]) ?? code ?? "—";
}

function actionLabel(tr: Tr, code: string) {
  const map: Record<string, string> = {
    merge: tr("合并", "Merge"),
    dedup: tr("去重", "Dedup"),
    unmerge: tr("拆分", "Unmerge"),
  };
  return map[code] ?? code;
}

function gmv(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? `¥${n.toLocaleString()}` : "—";
}

export default function AccountDetailPage() {
  const { id = "" } = useParams();
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [users, setUsers] = useState<Record<string, any>[] | null>(null);
  const [mergeLog, setMergeLog] = useState<MergeLogEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null); setUsers(null); setMergeLog(null); setErr(null);
    getAccount(tenant, id)
      .then(setDetail)
      .catch((e) => setErr(String(e?.response?.data?.detail || e)));
    listAccountUsers(tenant, id, 200)
      .then((r) => setUsers(r.data || []))
      .catch(() => setUsers([]));
    listAccountMergeLog(tenant, id, 50)
      .then(setMergeLog)
      .catch(() => setMergeLog([]));
  }, [id, tenant]);

  const account = detail?.account;
  const agg = detail?.aggregates;
  const hierarchy = detail?.hierarchy;

  // DataTable 列名与行键一致性：列名与 rows 的键须相等才显示
  const COL_USER = {
    phone: tr("手机号", "Phone"),
    tags: tr("标签", "Tags"),
    channels: tr("渠道数", "Channels"),
  };
  const COL_CHILD = {
    id: tr("子账户ID", "Sub-account ID"),
    level: tr("层级", "Level"),
    rel: tr("关系", "Relation"),
  };
  const COL_MERGE = {
    action: tr("动作", "Action"),
    master: tr("主账户", "Master account"),
    merged: tr("被合并账户", "Merged account"),
    users: tr("用户数", "Users"),
    operator: tr("操作人", "Operator"),
    time: tr("时间", "Time"),
  };

  const userView = (users || []).map((u) => ({
    OneID: u.one_id,
    [COL_USER.phone]: u.phone,
    [COL_USER.tags]: Array.isArray(u.tags) ? u.tags.join(", ") : u.tags,
    [COL_USER.channels]: u.channel_count,
    _id: u.one_id,
  }));

  const childView = (hierarchy?.children || []).map((c) => ({
    [COL_CHILD.id]: c.account_id,
    [COL_CHILD.level]: c.level,
    [COL_CHILD.rel]: c.relationship_type ?? "—",
    _id: c.account_id,
  }));

  const mergeView = (mergeLog || []).map((m) => ({
    [COL_MERGE.action]: actionLabel(tr, m.action),
    [COL_MERGE.master]: m.master_account_id,
    [COL_MERGE.merged]: m.merged_account_id,
    [COL_MERGE.users]: m.user_count ?? "—",
    [COL_MERGE.operator]: m.created_by ?? "—",
    [COL_MERGE.time]: m.created_at ?? "—",
  }));

  return (
    <Layout
      title={`${account?.name ?? id} · ${tr("客户详情", "Account Detail")}`}
      subtitle={`${tr("客户 Account", "Account")} · ${id}`}
      actions={<Link to="/accounts" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600"><ArrowLeft className="h-4 w-4" /> {tr("返回客户列表", "Back to accounts")}</Link>}
    >
      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!detail && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {account && (
        <>
          <StatCards items={[
            { label: tr("行业", "Industry"), value: account.industry ?? "—" },
            { label: tr("规模", "Scale"), value: scaleLabel(tr, account.scale) },
            { label: tr("关联用户", "Linked users"), value: agg?.user_count ?? (users ? users.length : "…") },
            { label: tr("累计 GMV", "Total GMV"), value: agg ? gmv(agg.total_gmv) : "—" },
          ]} />

          {/* 账户级聚合指标 */}
          <div className="mb-3 text-sm font-semibold text-gray-700">{tr("账户聚合指标 Aggregates", "Aggregates")}</div>
          <Card className="mb-6 p-5">
            {agg ? (
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3 lg:grid-cols-6">
                <Metric label={tr("用户数", "Users")} value={agg.user_count} />
                <Metric label={tr("活跃用户", "Active users")} value={agg.active_user_count} />
                <Metric label={tr("累计 GMV", "Total GMV")} value={gmv(agg.total_gmv)} />
                <Metric label={tr("购买次数", "Purchases")} value={agg.purchase_count} />
                <Metric label={tr("产品数", "Products")} value={agg.product_count} />
                <Metric label={tr("渠道数", "Channels")} value={agg.channel_count} />
                {Array.isArray(agg.tags) && agg.tags.length > 0 && (
                  <div className="col-span-2 md:col-span-3 lg:col-span-6">
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{tr("标签", "Tags")}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {agg.tags.map((t) => <Badge key={t} color="brand">{t}</Badge>)}
                    </div>
                  </div>
                )}
                {agg.last_update_time && (
                  <div className="col-span-2 text-xs text-gray-400 md:col-span-3 lg:col-span-6">
                    {tr("更新时间", "Updated")}：{agg.last_update_time}{agg.metric_date ? ` · ${tr("指标日期", "Metric date")} ${agg.metric_date}` : ""}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-400">{tr("暂无聚合指标", "No aggregates")}</div>
            )}
          </Card>

          {/* 账户层级 */}
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Building2 className="h-4 w-4 text-brand-500" /> {tr("账户层级 Hierarchy", "Hierarchy")}
            {hierarchy?.node?.parent_account_id && (
              <span className="font-normal text-gray-400">
                · {tr("上级", "Parent")} <Link className="text-brand-600" to={`/accounts/${hierarchy.node.parent_account_id}`}>{hierarchy.node.parent_account_id}</Link>
              </span>
            )}
          </div>
          <Card className="mb-6 p-2">
            {childView.length > 0 ? (
              <DataTable
                columns={[COL_CHILD.id, COL_CHILD.level, COL_CHILD.rel]}
                rows={childView}
                rowLink={(r) => `/accounts/${r._id}`}
              />
            ) : (
              <div className="px-4 py-6 text-sm text-gray-400">{tr("无下级账户", "No sub-accounts")}</div>
            )}
          </Card>

          {/* 该客户下的用户 */}
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Users className="h-4 w-4 text-brand-500" /> {tr("该客户下的用户 Users", "Users in this account")}
            {users && <Badge color="brand">{users.length}</Badge>}
            <span className="font-normal text-gray-400">· {tr("点击行查看用户档案", "Click a row to view the profile")}</span>
          </div>
          <Card className="mb-6 p-2">
            {!users ? (
              <div className="flex items-center gap-2 px-4 py-6 text-gray-500"><Spinner /> {tr("加载用户…", "Loading users…")}</div>
            ) : (
              <DataTable
                columns={["OneID", COL_USER.phone, COL_USER.tags, COL_USER.channels]}
                rows={userView}
                rowLink={(r) => `/unify/profiles/${r._id}`}
              />
            )}
          </Card>

          {/* 账户合并日志 */}
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <GitMerge className="h-4 w-4 text-brand-500" /> {tr("合并日志 Merge Log", "Merge Log")}
            {mergeLog && <Badge color="brand">{mergeLog.length}</Badge>}
          </div>
          <Card className="p-2">
            {!mergeLog ? (
              <div className="flex items-center gap-2 px-4 py-6 text-gray-500"><Spinner /> {tr("加载日志…", "Loading logs…")}</div>
            ) : (
              <DataTable
                columns={[COL_MERGE.action, COL_MERGE.master, COL_MERGE.merged, COL_MERGE.users, COL_MERGE.operator, COL_MERGE.time]}
                rows={mergeView}
              />
            )}
          </Card>
        </>
      )}
    </Layout>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-gray-900">{value ?? "—"}</div>
    </div>
  );
}
