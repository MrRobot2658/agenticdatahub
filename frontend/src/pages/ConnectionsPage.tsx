import { Link } from "react-router-dom";
import { FileSpreadsheet, Database, Radio, Cloud, Plus, ArrowRight, CheckCircle2 } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, Badge, Button } from "../components/ui";

// Sources 目录（对标 Segment Connections › Sources）。
const SOURCES = [
  { key: "csv", icon: FileSpreadsheet, name: "CSV / 粘贴", term: "CSV Upload", desc: "含表头的文本，导入任意对象", connected: true },
  { key: "mysql", icon: Database, name: "MySQL", term: "MySQL", desc: "业务库 / 离线宽表", connected: false },
  { key: "kafka", icon: Radio, name: "Kafka", term: "Kafka", desc: "实时事件流", connected: false },
  { key: "api", icon: Cloud, name: "REST API", term: "HTTP API", desc: "三方数据源拉取", connected: false },
];

export default function ConnectionsPage() {
  const connected = SOURCES.filter((s) => s.connected);
  const catalog = SOURCES.filter((s) => !s.connected);

  return (
    <Layout
      title="数据源 Sources"
      subtitle="把数据接入 Segment —— 一次接入，导入任意对象（Track once, send everywhere）"
      actions={
        <Link to="/connections/sources/new">
          <Button><Plus className="h-4 w-4" /> 添加数据源</Button>
        </Link>
      }
    >
      <div className="mb-2 text-sm font-semibold text-gray-700">已连接 · Connected</div>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {connected.map((s) => (
          <Link key={s.key} to="/connections/sources/new">
            <Card className="flex h-full flex-col p-5 transition-shadow hover:shadow-md">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <s.icon className="h-5 w-5" />
                </div>
                <Badge color="green">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> 已连接
                </Badge>
              </div>
              <div className="font-semibold text-gray-900">{s.name}</div>
              <div className="mt-0.5 text-sm text-gray-500">{s.desc}</div>
              <div className="mt-4 flex items-center gap-1 text-sm font-medium text-brand-600">
                导入数据 <ArrowRight className="h-4 w-4" />
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mb-2 text-sm font-semibold text-gray-700">目录 · Catalog</div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {catalog.map((s) => (
          <Card key={s.key} className="flex h-full flex-col p-5 opacity-90">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                <s.icon className="h-5 w-5" />
              </div>
              <Badge color="gray">路线图</Badge>
            </div>
            <div className="font-semibold text-gray-900">{s.name}</div>
            <div className="mt-0.5 text-sm text-gray-500">{s.desc}</div>
            <div className="mt-4 text-sm text-gray-400">适配器尚未接入</div>
          </Card>
        ))}
      </div>
    </Layout>
  );
}
