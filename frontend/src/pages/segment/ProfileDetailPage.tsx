import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Layout from "../../components/layout/Layout";
import { Card, Badge } from "../../components/ui";
import { Timeline, MockTag } from "../../components/segment/kit";
import { profileSample } from "../../mock/data";

export default function ProfileDetailPage() {
  useParams();
  const p = profileSample;
  return (
    <Layout
      title={`${p.name} · 用户档案`}
      subtitle={`OneID ${p.oneId}`}
      actions={<><MockTag /><Link to="/unify" className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><ArrowLeft className="h-4 w-4" /> 返回</Link></>}
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-1">
          <Card className="p-5">
            <div className="mb-3 font-semibold text-gray-900">身份标识 Identifiers</div>
            <dl className="space-y-2">
              {p.identifiers.map((id) => (
                <div key={id.type} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-gray-500">{id.type}</dt>
                  <dd className="font-mono text-gray-900">{id.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card className="p-5">
            <div className="mb-3 font-semibold text-gray-900">特征 Traits</div>
            <dl className="space-y-2 text-sm">
              <Row label="phone" value={p.traits.phone} />
              <Row label="city" value={p.traits.city} />
              <Row label="channel_count" value={p.traits.channel_count} />
              <Row label="lifetime_value" value={`¥${p.traits.lifetime_value.toLocaleString()}`} />
              <div>
                <div className="mb-1 text-gray-500">tags</div>
                <div className="flex flex-wrap gap-1.5">
                  {p.traits.tags.map((t) => <Badge key={t} color="brand">{t}</Badge>)}
                </div>
              </div>
            </dl>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card className="p-5">
            <div className="mb-4 font-semibold text-gray-900">事件时间线 Event Timeline</div>
            <Timeline items={p.events} />
          </Card>
        </div>
      </div>
    </Layout>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{value}</dd>
    </div>
  );
}
