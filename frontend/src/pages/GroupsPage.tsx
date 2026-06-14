import { useEffect, useState, useCallback } from "react";
import { Boxes, RefreshCw } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Spinner, Button } from "../components/ui";
import { StatCards, StatusPill } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import { byKey } from "../lib/objects";
import { listGroups, refreshGroup, type UnifyGroup } from "../api/unify";

type Filter = "all" | "static" | "dynamic";

export default function GroupsPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [groups, setGroups] = useState<UnifyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [refreshing, setRefreshing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setGroups(await listGroups(tenant, filter === "all" ? undefined : filter));
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || tr("加载失败", "Failed to load"));
    } finally {
      setLoading(false);
    }
  }, [tenant, filter]);

  useEffect(() => { load(); }, [load]);

  async function refresh(groupId: number) {
    setRefreshing(groupId); setError(null); setMsg(null);
    try {
      const r = await refreshGroup(tenant, groupId);
      setMsg(tr(
        `群组 ${groupId} 刷新完成：命中 ${r.matched}，当前成员 ${r.member_count}`,
        `Group ${groupId} refreshed: matched ${r.matched}, current members ${r.member_count}`
      ));
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || tr("刷新失败", "Refresh failed"));
    } finally {
      setRefreshing(null);
    }
  }

  const dynamicCount = groups.filter((g) => g.group_type === "dynamic").length;
  const totalMembers = groups.reduce((a, g) => a + (g.member_count || 0), 0);

  const COL = {
    group: tr("群组", "Group"),
    type: tr("类型", "Type"),
    memberObj: tr("成员对象", "Member Object"),
    memberCount: tr("成员数", "Members"),
    updatedAt: tr("更新时间", "Updated At"),
  };

  return (
    <Layout
      title={tr("群组 Groups", "Groups")}
      subtitle={tr("对象的集合（人群包）—— 静态名单 / 动态规则，成员可为任意对象类型", "Collections of objects (audiences) — static lists / dynamic rules, members can be any object type")}
    >
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
      {msg && <div className="mb-4 rounded-lg bg-brand-50 px-4 py-2 text-sm text-brand-700">{msg}</div>}

      <StatCards items={[
        { label: tr("群组数", "Groups"), value: groups.length },
        { label: tr("动态群组", "Dynamic Groups"), value: dynamicCount },
        { label: tr("静态群组", "Static Groups"), value: groups.length - dynamicCount },
        { label: tr("成员合计", "Total Members"), value: totalMembers },
      ]} />

      <div className="mb-4 flex gap-1">
        {([["all", tr("全部", "All")], ["dynamic", tr("动态", "Dynamic")], ["static", tr("静态", "Static")]] as [Filter, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === k ? "bg-brand-50 text-brand-700" : "text-gray-500 hover:bg-gray-100"}`}>
            {label}
          </button>
        ))}
      </div>

      <Card className="p-2">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <DataTable
            columns={[COL.group, COL.type, COL.memberObj, COL.memberCount, COL.updatedAt, ""]}
            rows={groups.map((g) => ({
              [COL.group]: g.group_name || tr(`群组 ${g.group_id}`, `Group ${g.group_id}`),
              [COL.type]: <StatusPill tone={g.group_type === "dynamic" ? "blue" : "gray"}>
                {g.group_type === "dynamic" ? tr("动态", "Dynamic") : tr("静态", "Static")}
              </StatusPill>,
              [COL.memberObj]: byKey(g.member_object_type || "user")?.label || g.member_object_type || tr("用户", "Users"),
              [COL.memberCount]: g.member_count ?? 0,
              [COL.updatedAt]: g.updated_at ?? "—",
              "": g.group_type === "dynamic" ? (
                <button onClick={(e) => { e.stopPropagation(); refresh(g.group_id); }}
                  disabled={refreshing === g.group_id}
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50">
                  <RefreshCw className="h-3.5 w-3.5" /> {refreshing === g.group_id ? tr("刷新中", "Refreshing") : tr("刷新成员", "Refresh members")}
                </button>
              ) : <span className="text-gray-300">—</span>,
            }))}
          />
        )}
        {!loading && groups.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <Boxes className="h-6 w-6" />
            </div>
            <div className="font-semibold text-gray-900">{tr("暂无群组", "No groups")}</div>
            <div className="max-w-sm text-sm text-gray-500">
              {tr("在「受众」中基于筛选「存为群组」，或导入静态名单后在此管理与刷新。", "Use \"Save as group\" from a filter under Audiences, or import a static list, then manage and refresh them here.")}
            </div>
            <Button className="mt-2" variant="outline" onClick={load}>
              <RefreshCw className="h-4 w-4" /> {tr("刷新列表", "Refresh list")}
            </Button>
          </div>
        )}
      </Card>
    </Layout>
  );
}
