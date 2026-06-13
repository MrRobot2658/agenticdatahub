import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Layout from "../../components/layout/Layout";
import { Badge, Card, DataTable } from "../../components/ui";
import { StatCards, SubTabs, MockTag } from "../../components/segment/kit";
import { sourceDetail } from "../../mock/data";

export default function SourceDetailPage() {
  useParams();
  const key = sourceDetail.writeKey;
  const masked = `${key.slice(0, 6)}…${key.slice(-4)}`;

  const rows = sourceDetail.recent.map((r) => ({
    时间: r.time,
    事件: r.event,
    anonymousId: r.anonymousId,
    状态: r.status,
  }));

  return (
    <Layout
      title={`${sourceDetail.name} · 数据源详情`}
      subtitle="实时事件、Schema 与 Debugger（仅演示）"
      actions={<><MockTag /><Link to="/connections" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft className="h-4 w-4" /> 返回连接</Link></>}
    >
      <SubTabs tabs={[
        { label: "概览", to: "#", active: true },
        { label: "Schema", to: "#" },
        { label: "Debugger", to: "#" },
      ]} />
      <StatCards items={[
        { label: "近24h事件", value: sourceDetail.events24h.toLocaleString() },
        { label: "Write Key", value: <span className="font-mono text-base">{masked}</span> },
        { label: "Schema 事件数", value: sourceDetail.schemaEvents.length },
      ]} />
      <Card className="mb-6 p-5">
        <div className="mb-3 text-sm font-semibold text-gray-900">Schema 事件</div>
        <div className="flex flex-wrap gap-2">
          {sourceDetail.schemaEvents.map((e) => <Badge key={e} color="brand">{e}</Badge>)}
        </div>
      </Card>
      <div className="mb-2 text-sm font-semibold text-gray-900">实时事件 (Debugger)</div>
      <DataTable columns={["时间", "事件", "anonymousId", "状态"]} rows={rows} />
    </Layout>
  );
}
