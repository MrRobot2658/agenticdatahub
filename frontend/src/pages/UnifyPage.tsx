import { Link } from "react-router-dom";
import { Fingerprint, GitMerge, ArrowRight } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card } from "../components/ui";
import UnifiedFilter from "../components/filter/UnifiedFilter";
import { OBJECTS } from "../lib/objects";
import { useLang } from "../context/LangContext";

const linked = OBJECTS.filter((o) => o.kind === "object" && o.key !== "user");

export default function UnifyPage() {
  const { tr } = useLang();
  return (
    <Layout
      title={tr("用户档案 Profiles", "Profiles")}
      subtitle={tr("跨数据源合并为统一身份（OneID）—— 按标识符或属性检索用户档案", "Merge identities across sources into a unified identity (OneID) — search profiles by identifier or attribute")}
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card className="flex items-center gap-4 p-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Fingerprint className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold text-gray-900">{tr("身份解析 Identity Resolution", "Identity Resolution")}</div>
            <div className="text-sm text-gray-500">{tr("channel → one_id 实时识别与 merge", "Real-time channel → one_id resolution & merge")}</div>
          </div>
        </Card>
        <Card className="flex items-center gap-4 p-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <GitMerge className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold text-gray-900">{tr("关联对象 Linked Objects", "Linked Objects")}</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {linked.map((o) => (
                <Link key={o.key} to={`/objects/${o.key}`}
                  className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200">
                  <o.icon className="h-3.5 w-3.5" /> {o.label}
                </Link>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
        Profile Explorer
        <span className="font-normal text-gray-400">{tr("用户宽表 · OneID", "User wide table · OneID")}</span>
        <Link to="/engage/audiences/new" className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-brand-600">
          {tr("基于筛选创建受众", "Create audience from filter")} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <UnifiedFilter baseObject="user" lockBase autoSearch rowLink={(r) => (r.one_id != null ? `/unify/profiles/${r.one_id}` : undefined)} />
    </Layout>
  );
}
