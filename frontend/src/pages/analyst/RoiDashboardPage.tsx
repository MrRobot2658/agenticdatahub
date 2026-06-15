import { useEffect, useState } from "react";
import Layout from "../../components/layout/Layout";
import { Card, Spinner } from "../../components/ui";
import { StatCards } from "../../components/segment/kit";
import AnalystChart from "../../components/analyst/AnalystChart";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import { getKpis, type Kpis } from "../../api/analyst";

const pct = (x: number) => (x * 100).toFixed(1) + "%";
const money = (x: number) => "¥" + x.toLocaleString();

// 转化率ROI看板：转化漏斗与营收效率指标 + 可下钻图表。
export default function RoiDashboardPage() {
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
      title={tr("转化率ROI看板", "Conversion & ROI")}
      subtitle={tr("从线索到订单的转化漏斗与营收效率", "Conversion funnel from leads to orders and revenue efficiency")}
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {!kpis && !err && <div className="mb-6 flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}
      {kpis && (
        <StatCards items={[
          { label: tr("线索转化率", "Lead Conversion"), value: pct(kpis.lead_qualified_rate) },
          { label: tr("订单支付率", "Order Paid Rate"), value: pct(kpis.order_paid_rate) },
          { label: tr("GMV", "GMV"), value: money(kpis.gmv) },
          { label: tr("客单价", "AOV"), value: money(kpis.aov) },
        ]} />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <AnalystChart tenant={tenant} title={tr("转化漏斗 · 线索阶段", "Funnel · Lead Stage")} type="bar" source="lead_stage" />
        <AnalystChart tenant={tenant} title={tr("订单状态分布", "Order Status")} type="pie" source="order_status" />
        <AnalystChart tenant={tenant} title={tr("订单渠道分布", "Order Channel")} type="bar" source="order_channel" />
        <AnalystChart tenant={tenant} title={tr("各对象数据量", "Object Volumes")} type="bar" source="objects_count" />
      </div>
    </Layout>
  );
}
