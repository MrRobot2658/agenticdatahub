import { useEffect, useState } from "react";
import Layout from "../../components/layout/Layout";
import { Card, Spinner } from "../../components/ui";
import { StatCards } from "../../components/segment/kit";
import AnalystChart from "../../components/analyst/AnalystChart";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import { getKpis, type Kpis } from "../../api/analyst";

const pct = (x: number) => (x * 100).toFixed(1) + "%";

// 用户画像看板：用户/线索维度的 KPI + 可下钻图表。
export default function UserDashboardPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setKpis(null); setErr(null);
    getKpis(tenant).then(setKpis).catch((e) => setErr(String(e)));
  }, [tenant]);

  return (
    <Layout
      title={tr("用户画像看板", "User Profile")}
      subtitle={tr("用户与线索维度的核心指标与分布", "Core metrics and distributions for users and leads")}
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!kpis && !err && <div className="mb-6 flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}
      {kpis && (
        <StatCards items={[
          { label: tr("用户数", "Users"), value: kpis.users },
          { label: tr("线索数", "Leads"), value: kpis.leads },
          { label: tr("合格线索", "Qualified Leads"), value: kpis.leads_qualified },
          { label: tr("转化率", "Conversion"), value: pct(kpis.lead_qualified_rate) },
        ]} />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <AnalystChart tenant={tenant} title={tr("各对象数据量", "Object Volumes")} type="bar" source="objects_count" />
        <AnalystChart tenant={tenant} title={tr("线索阶段分布", "Lead Stage")} type="bar" source="lead_stage" />
        <AnalystChart tenant={tenant} title={tr("线索城市分布", "Lead City")} type="bar" source="lead_city" />
        <AnalystChart tenant={tenant} title={tr("线索来源分布", "Lead Source")} type="pie" source="lead_source" />
      </div>
    </Layout>
  );
}
