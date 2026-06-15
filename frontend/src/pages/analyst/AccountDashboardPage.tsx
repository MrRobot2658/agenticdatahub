import { useEffect, useState } from "react";
import Layout from "../../components/layout/Layout";
import { Card, Spinner } from "../../components/ui";
import { StatCards } from "../../components/segment/kit";
import AnalystChart from "../../components/analyst/AnalystChart";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import { getKpis, type Kpis } from "../../api/analyst";

const money = (x: number) => "¥" + x.toLocaleString();

// 客户画像看板：客户/订单维度的 KPI + 可下钻图表。
export default function AccountDashboardPage() {
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
      title={tr("客户画像看板", "Account Profile")}
      subtitle={tr("客户与订单维度的核心指标与分布", "Core metrics and distributions for accounts and orders")}
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!kpis && !err && <div className="mb-6 flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}
      {kpis && (
        <StatCards items={[
          { label: tr("客户数", "Accounts"), value: kpis.accounts },
          { label: tr("订单数", "Orders"), value: kpis.orders },
          { label: tr("GMV", "GMV"), value: money(kpis.gmv) },
          { label: tr("客单价", "AOV"), value: money(kpis.aov) },
        ]} />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <AnalystChart tenant={tenant} title={tr("客户行业分布", "Account Industry")} type="pie" source="account_industry" />
        <AnalystChart tenant={tenant} title={tr("客户规模分布", "Account Scale")} type="pie" source="account_scale" />
        <AnalystChart tenant={tenant} title={tr("订单状态分布", "Order Status")} type="pie" source="order_status" />
        <AnalystChart tenant={tenant} title={tr("订单渠道分布", "Order Channel")} type="bar" source="order_channel" />
      </div>
    </Layout>
  );
}
