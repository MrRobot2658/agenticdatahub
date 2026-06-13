import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Layout from "../../components/layout/Layout";
import { Card, Badge } from "../../components/ui";
import { StatCards, Sparkline, MockTag } from "../../components/segment/kit";
import { audienceSample } from "../../mock/data";

export default function AudienceDetailPage() {
  useParams();
  const a = audienceSample;
  return (
    <Layout
      title={`${a.name} · 受众详情`}
      subtitle={`code ${a.code}`}
      actions={<><MockTag /><Link to="/engage" className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /> 返回</Link></>}
    >
      <StatCards items={[
        { label: "当前规模", value: a.size },
        { label: "条件", value: <span className="text-sm font-medium">{a.conditions}</span> },
        { label: "连接目的地", value: a.connectedDestinations.length },
      ]} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 font-semibold text-gray-900">规模趋势 Size over time</div>
          <Sparkline data={a.trend} height={80} />
          <div className="mt-2 text-xs text-gray-500">最近 12 个周期的受众规模变化</div>
        </Card>
        <Card className="p-5">
          <div className="mb-3 font-semibold text-gray-900">连接的目的地</div>
          <div className="flex flex-wrap gap-1.5">
            {a.connectedDestinations.map((d) => <Badge key={d} color="brand">{d}</Badge>)}
          </div>
        </Card>
      </div>
    </Layout>
  );
}
