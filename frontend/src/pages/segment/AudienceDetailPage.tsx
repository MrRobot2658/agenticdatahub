import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Layout from "../../components/layout/Layout";
import { Card, Badge } from "../../components/ui";
import { StatCards, Sparkline, MockTag } from "../../components/segment/kit";
import { audienceSample } from "../../mock/data";
import { useLang } from "../../context/LangContext";

export default function AudienceDetailPage() {
  useParams();
  const { tr } = useLang();
  const a = audienceSample;
  return (
    <Layout
      title={`${a.name} · ${tr("受众详情", "Audience details")}`}
      subtitle={`code ${a.code}`}
      actions={<><MockTag /><Link to="/engage" className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /> {tr("返回", "Back")}</Link></>}
    >
      <StatCards items={[
        { label: tr("当前规模", "Current size"), value: a.size },
        { label: tr("条件", "Conditions"), value: <span className="text-sm font-medium">{a.conditions}</span> },
        { label: tr("连接目的地", "Connected destinations"), value: a.connectedDestinations.length },
      ]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 font-semibold text-gray-900">{tr("规模趋势 Size over time", "Size over time")}</div>
          <Sparkline data={a.trend} height={80} />
          <div className="mt-2 text-xs text-gray-500">{tr("最近 12 个周期的受众规模变化", "Audience size over the last 12 periods")}</div>
        </Card>
        <Card className="p-5">
          <div className="mb-3 font-semibold text-gray-900">{tr("连接的目的地", "Connected destinations")}</div>
          <div className="flex flex-wrap gap-1.5">
            {a.connectedDestinations.map((d) => <Badge key={d} color="brand">{d}</Badge>)}
          </div>
        </Card>
      </div>
    </Layout>
  );
}
