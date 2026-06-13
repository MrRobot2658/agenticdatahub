import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Filter, Workflow, ArrowRight } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, Spinner } from "../components/ui";
import { OBJECTS, byKey } from "../lib/objects";
import { searchObjects, listTags, listSegments } from "../api/client";
import { useTenant } from "../context/TenantContext";

const COUNTED = ["user", "account", "order", "product", "store"];

// 对象卡 → Segment IA 路由
const ROUTE: Record<string, string> = {
  user: "/unify",
  account: "/unify/objects/account",
  order: "/unify/objects/order",
  product: "/unify/objects/product",
  store: "/unify/objects/store",
  tag: "/engage/traits",
  segment: "/engage",
};

export default function Dashboard() {
  const { tenant } = useTenant();
  const [counts, setCounts] = useState<Record<string, number | null>>({});

  useEffect(() => {
    let alive = true;
    setCounts({});
    const tasks: Promise<void>[] = COUNTED.map(async (k) => {
      try {
        const r = await searchObjects({ tenant_id: tenant, object: k, count_only: true });
        if (alive) setCounts((c) => ({ ...c, [k]: r.estimate ?? r.row_count ?? 0 }));
      } catch {
        if (alive) setCounts((c) => ({ ...c, [k]: -1 }));
      }
    });
    tasks.push(
      listTags(tenant).then((t) => { if (alive) setCounts((c) => ({ ...c, tag: t.length })); }).catch(() => {}),
      listSegments(tenant).then((s) => { if (alive) setCounts((c) => ({ ...c, segment: s.length })); }).catch(() => {}),
    );
    return () => { alive = false; };
  }, [tenant]);

  const cards = [...COUNTED, "tag", "segment"];

  return (
    <Layout title="概览 Overview" subtitle="客户数据平台 · Connections → Unify → Engage 全链路概览">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-7">
        {cards.map((k) => {
          const cfg = byKey(k)!;
          const v = counts[k];
          return (
            <Link key={k} to={ROUTE[k] ?? "/"}>
              <Card className="p-4 transition-shadow hover:shadow-md">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <cfg.icon className="h-5 w-5" />
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {v === undefined ? <span className="text-gray-300">—</span> : v === -1 ? "?" : v}
                </div>
                <div className="text-sm text-gray-500">{cfg.label}</div>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Link to="/engage/audiences/new">
          <Card className="flex items-center justify-between p-6 transition-shadow hover:shadow-md">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-white">
                <Filter className="h-6 w-6" />
              </div>
              <div>
                <div className="font-semibold text-gray-900">创建受众 · Engage</div>
                <div className="text-sm text-gray-500">多条件 / 跨对象 / 自然语言圈人</div>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-300" />
          </Card>
        </Link>
        <Link to="/connections/sources/new">
          <Card className="flex items-center justify-between p-6 transition-shadow hover:shadow-md">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-400 text-white">
                <Workflow className="h-6 w-6" />
              </div>
              <div>
                <div className="font-semibold text-gray-900">接入数据源 · Connections</div>
                <div className="text-sm text-gray-500">多数据源 → 导入多对象</div>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-gray-300" />
          </Card>
        </Link>
      </div>

      {Object.keys(counts).length < cards.length && (
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-400"><Spinner /> 统计加载中…</div>
      )}
    </Layout>
  );
}
