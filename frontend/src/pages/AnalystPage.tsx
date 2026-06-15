import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Sparkles, Trash2, UserSearch, Building2, Gauge, LayoutDashboard } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, Button, Spinner, Modal, Badge } from "../components/ui";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import {
  listDashboards, nlDashboard, saveDashboard, deleteDashboard,
  type Dashboard,
} from "../api/analyst";

// 内置画像看板（硬编码，指向各自的固定路由）。
const BUILTINS = [
  { to: "/analyst/dashboards/user", icon: UserSearch, zh: "用户画像看板", en: "User Profile",
    descZh: "用户与线索维度的核心指标与分布", descEn: "Core metrics for users and leads" },
  { to: "/analyst/dashboards/account", icon: Building2, zh: "客户画像看板", en: "Account Profile",
    descZh: "客户与商机维度的分布与画像", descEn: "Distributions across accounts" },
  { to: "/analyst/dashboards/roi", icon: Gauge, zh: "转化率ROI看板", en: "Conversion & ROI",
    descZh: "线索转化、订单转化与 GMV/ROI", descEn: "Lead/order conversion and GMV/ROI" },
];

// 看板列表：内置画像看板 + 自然语言创建的自定义看板（NL 直接生成并创建，进详情可二次编辑）。
export default function AnalystPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const navigate = useNavigate();

  const [dashboards, setDashboards] = useState<Dashboard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [modalErr, setModalErr] = useState<string | null>(null);

  function load() {
    setErr(null);
    listDashboards(tenant).then(setDashboards).catch((e) => setErr(String(e)));
  }
  useEffect(() => { setDashboards(null); load(); /* eslint-disable-next-line */ }, [tenant]);

  // NL 直接生成 + 创建，然后跳转到看板详情（可二次编辑）
  async function onCreate() {
    if (!q.trim()) return;
    setCreating(true); setModalErr(null);
    try {
      const d = await nlDashboard(tenant, q.trim());
      const saved = await saveDashboard(tenant, { title: d.title, sources: d.sources });
      setOpen(false); setQ("");
      navigate(`/analyst/dashboards/custom/${saved.id}`);
    } catch (e: any) {
      setModalErr(e?.response?.data?.detail || e.message || tr("生成失败", "Failed to generate"));
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(d: Dashboard) {
    if (!window.confirm(tr(`删除看板「${d.title}」？`, `Delete dashboard "${d.title}"?`))) return;
    try { await deleteDashboard(tenant, d.id); load(); }
    catch (e: any) { setErr(e?.response?.data?.detail || e.message || tr("删除失败", "Failed to delete")); }
  }

  return (
    <Layout
      title={tr("看板列表 Dashboards", "Dashboards")}
      subtitle={tr("用自然语言直接创建自定义看板，或打开内置画像看板", "Create custom dashboards with natural language, or open the built-in profile dashboards")}
      actions={
        <Button onClick={() => { setQ(""); setModalErr(null); setOpen(true); }}>
          <Plus className="h-4 w-4" /> {tr("新建看板", "New Dashboard")}
        </Button>
      }
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      {!dashboards && !err && (
        <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>
      )}

      {dashboards && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BUILTINS.map((b) => (
            <Link key={b.to} to={b.to}>
              <Card className="flex h-full flex-col p-5 transition-shadow hover:shadow-md">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <b.icon className="h-5 w-5" />
                  </div>
                  <Badge color="brand">{tr("内置", "Built-in")}</Badge>
                </div>
                <div className="font-semibold text-gray-900">{tr(b.zh, b.en)}</div>
                <div className="mt-1 text-sm text-gray-500">{tr(b.descZh, b.descEn)}</div>
              </Card>
            </Link>
          ))}

          {dashboards.map((d) => (
            <Link key={d.id} to={`/analyst/dashboards/custom/${d.id}`}>
              <Card className="flex h-full flex-col p-5 transition-shadow hover:shadow-md">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <LayoutDashboard className="h-5 w-5" />
                  </div>
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(d); }}
                    className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    title={tr("删除", "Delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="font-semibold text-gray-900">{d.title}</div>
                <div className="mt-1 text-sm text-gray-500">
                  {tr(`${d.chart_count ?? 0} 个图表`, `${d.chart_count ?? 0} charts`)}
                </div>
                {d.created_at && <div className="mt-1 text-xs text-gray-400">{d.created_at}</div>}
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Modal open={open} title={tr("新建看板", "New Dashboard")} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-brand-700">
              <Sparkles className="h-4 w-4" /> {tr("自然语言生成", "Generate with NL")}
            </div>
            <textarea
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              rows={3} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={tr("用一句话描述看板，如：做一个电商运营看板，看订单和商品", "Describe a dashboard, e.g. an e-commerce ops dashboard")}
            />
            <div className="mt-1 text-xs text-gray-400">{tr("生成后直接创建，进看板可二次编辑（改标题 / 加减图表）", "Created directly; you can edit it (title / add/remove charts) afterwards")}</div>
          </div>

          {modalErr && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{modalErr}</div>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button onClick={onCreate} disabled={creating || !q.trim()}>
              {creating ? <Spinner /> : <Sparkles className="h-4 w-4" />} {tr("生成并创建", "Generate & Create")}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
