import { Megaphone, Mail, BarChart3, Webhook } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, Badge } from "../components/ui";

// Destinations 目录（对标 Segment Connections › Destinations）。当前为路线图占位。
const DESTS = [
  { icon: Megaphone, name: "广告平台", term: "Advertising", desc: "把受众同步到投放渠道" },
  { icon: Mail, name: "营销自动化", term: "Marketing / MA", desc: "EDM / 短信 / Push 触达" },
  { icon: BarChart3, name: "分析 / BI", term: "Analytics", desc: "明细回流数仓 / 报表" },
  { icon: Webhook, name: "Webhook", term: "Webhook", desc: "自定义下游回调" },
];

export default function DestinationsPage() {
  return (
    <Layout
      title="目的地 Destinations"
      subtitle="把清洗、统一后的数据激活到下游工具（路线图）"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DESTS.map((d) => (
          <Card key={d.name} className="flex h-full flex-col p-5 opacity-90">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                <d.icon className="h-5 w-5" />
              </div>
              <Badge color="gray">路线图</Badge>
            </div>
            <div className="font-semibold text-gray-900">{d.name}</div>
            <div className="mt-0.5 text-xs uppercase tracking-wide text-gray-400">{d.term}</div>
            <div className="mt-1 text-sm text-gray-500">{d.desc}</div>
          </Card>
        ))}
      </div>
    </Layout>
  );
}
