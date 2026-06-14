import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import Layout from "../../components/layout/Layout";
import { Card, Badge, Spinner } from "../../components/ui";
import { Timeline, type TimelineItem } from "../../components/segment/kit";
import { searchObjects } from "../../api/client";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";

// 用户档案详情 —— 真实数据：按 one_id 查 doris_user_wide，渲染身份标识 / 特征 / 行为时间线。
const ID_FIELDS = ["one_id", "phone", "email", "wechat_openid", "wechat_unionid", "wework_extid", "form_id", "device"];

export default function ProfileDetailPage() {
  const { id = "" } = useParams();
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [row, setRow] = useState<Record<string, any> | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRow(undefined); setErr(null);
    searchObjects({ tenant_id: tenant, object: "user", limit: 1, conditions: [{ field: "one_id", op: "eq", value: Number(id) || id }] })
      .then((r) => setRow(r.data?.[0] ?? null))
      .catch((e) => setErr(String(e)));
  }, [id, tenant]);

  const back = (
    <Link to="/unify" className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
      <ArrowLeft className="h-4 w-4" /> {tr("返回", "Back")}
    </Link>
  );

  if (err) return <Layout title={tr("用户档案", "User Profile")} actions={back}><Card className="p-5 text-sm text-red-600">{err}</Card></Layout>;
  if (row === undefined) return <Layout title={tr("用户档案", "User Profile")} actions={back}><div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div></Layout>;
  if (row === null) return <Layout title={tr("用户档案", "User Profile")} actions={back}><Card className="p-6 text-sm text-gray-500">{tr(`未找到 OneID ${id} 的用户`, `No user found for OneID ${id}`)}</Card></Layout>;

  const props = (row.properties || {}) as Record<string, any>;
  const tags: string[] = Array.isArray(row.tags) ? row.tags : [];
  const identifiers = ID_FIELDS.map((f) => ({ type: f, value: row[f] })).filter((x) => x.value != null && x.value !== "");
  const behaviors: any[] = Array.isArray(props.behaviors) ? props.behaviors : [];
  const events: TimelineItem[] = [...behaviors]
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 12)
    .map((b) => ({
      time: String(b.at ?? "").replace("T", " ").slice(0, 19),
      title: b.event_type || "event",
      desc: [b.channel_type, b.channel_id].filter(Boolean).join(" · "),
      tone: "green" as const,
    }));

  return (
    <Layout title={tr(`OneID ${row.one_id} · 用户档案`, `OneID ${row.one_id} · User Profile`)} subtitle={tr(`渠道数 ${row.channel_count ?? 0} · 标签 ${tags.length}`, `Channels ${row.channel_count ?? 0} · Tags ${tags.length}`)} actions={back}>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-1">
          <Card className="p-5">
            <div className="mb-3 font-semibold text-gray-900">{tr("身份标识 Identifiers", "Identifiers")}</div>
            <dl className="space-y-2">
              {identifiers.map((id) => (
                <div key={id.type} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-gray-500">{id.type}</dt>
                  <dd className="truncate font-mono text-gray-900" title={String(id.value)}>{String(id.value)}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card className="p-5">
            <div className="mb-3 font-semibold text-gray-900">{tr("特征 Traits", "Traits")}</div>
            <dl className="space-y-2 text-sm">
              <Row label="channel_count" value={row.channel_count ?? "—"} />
              <Row label="total_orders" value={props.total_orders ?? "—"} />
              <Row label="total_amount" value={props.total_amount != null ? `¥${Number(props.total_amount).toLocaleString()}` : "—"} />
              <Row label="last_channel" value={props.last_channel ?? "—"} />
              <Row label="last_login" value={props.last_login ?? "—"} />
              <div>
                <div className="mb-1 text-gray-500">tags</div>
                <div className="flex flex-wrap gap-1.5">
                  {tags.length ? tags.map((t) => <Badge key={t} color="brand">{t}</Badge>) : <span className="text-gray-400">{tr("无", "None")}</span>}
                </div>
              </div>
            </dl>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card className="p-5">
            <div className="mb-4 font-semibold text-gray-900">{tr("行为时间线 Event Timeline", "Event Timeline")}</div>
            {events.length ? <Timeline items={events} /> : <div className="text-sm text-gray-400">{tr("暂无行为记录", "No event records")}</div>}
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
