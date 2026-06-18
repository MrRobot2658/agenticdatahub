import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { Badge } from "../../ui";
import { searchObjects } from "../../../api/client";
import { useTenant } from "../../../context/TenantContext";
import { CHANNEL_ID_FIELDS, channelLabel } from "../../../lib/channels";
import CardShell from "./CardShell";

// 用户画像360 内联卡片：按 one_id 查 doris_user_wide，展示身份/渠道分布/特征/行为时间线。
const ID_FIELDS = ["one_id", "phone", "email", "wechat_openid", "wechat_unionid", "wework_extid",
  "form_id", "device", "web_visitor_id", "wechat_mp_openid", "wechat_channels_id", "xiaohongshu_id", "douyin_id"];
const CHANNEL_FIELDS = CHANNEL_ID_FIELDS.filter((f) => f !== "phone" && f !== "email");

export default function ProfileCard({ one_id }: { one_id: number | string }) {
  const { tenant } = useTenant();
  const [row, setRow] = useState<Record<string, any> | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRow(undefined); setErr(null);
    searchObjects({ tenant_id: tenant, object: "user", limit: 1, conditions: [{ field: "one_id", op: "eq", value: Number(one_id) || one_id }] })
      .then((r) => setRow(r.data?.[0] ?? null))
      .catch((e) => setErr(e?.response?.data?.detail || String(e)));
  }, [one_id, tenant]);

  const loading = row === undefined && !err;
  const props = (row?.properties || {}) as Record<string, any>;
  const tags: string[] = Array.isArray(row?.tags) ? row!.tags : [];
  const ids = ID_FIELDS.map((f) => ({ f, v: row?.[f] })).filter((x) => x.v != null && x.v !== "");
  const channels = CHANNEL_FIELDS.filter((f) => row?.[f] != null && row?.[f] !== "");
  const behaviors: any[] = Array.isArray(props.behaviors) ? props.behaviors : [];
  const timeline = [...behaviors].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 6);

  return (
    <CardShell
      icon={<UserRound className="h-4 w-4" />}
      title={row ? `OneID ${row.one_id} · 用户画像` : "用户画像"}
      subtitle={row ? `渠道数 ${row.channel_count ?? channels.length} · 标签 ${tags.length}` : undefined}
      loading={loading}
      error={err}
    >
      {row === null ? (
        <div className="text-[13px] text-gray-400">未找到 OneID {one_id} 的用户</div>
      ) : row ? (
        <div className="space-y-3">
          {channels.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium text-gray-400">渠道分布</div>
              <div className="flex flex-wrap gap-1">
                {channels.map((f) => <Badge key={f} color="brand" title={f}>{channelLabel(f)}</Badge>)}
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2 text-[12px]">
            <Trait label="渠道数" value={row.channel_count ?? channels.length} />
            <Trait label="订单数" value={props.total_orders ?? "—"} />
            <Trait label="消费额" value={props.total_amount != null ? `¥${Number(props.total_amount).toLocaleString()}` : "—"} />
          </div>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">{tags.map((t) => <Badge key={t} color="amber">{t}</Badge>)}</div>
          )}
          <div>
            <div className="mb-1 text-[11px] font-medium text-gray-400">身份标识</div>
            <dl className="space-y-0.5">
              {ids.slice(0, 6).map((x) => (
                <div key={x.f} className="flex items-center justify-between gap-3 text-[12px]">
                  <dt className="text-gray-400">{x.f === "one_id" ? "OneID" : channelLabel(x.f)}</dt>
                  <dd className="truncate font-mono text-gray-700" title={String(x.v)}>{String(x.v)}</dd>
                </div>
              ))}
            </dl>
          </div>
          {timeline.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-medium text-gray-400">行为时间线</div>
              <ul className="space-y-1">
                {timeline.map((b, i) => (
                  <li key={i} className="flex items-center gap-2 text-[12px] text-gray-600">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                    <span className="font-medium text-gray-800">{b.event_type}</span>
                    <span className="text-gray-400">· {channelLabel(b.channel_type)}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-gray-300">{String(b.at ?? "").replace("T", " ").slice(5, 16)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </CardShell>
  );
}

function Trait({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2 py-1.5">
      <div className="text-[10px] text-gray-400">{label}</div>
      <div className="truncate font-semibold text-gray-800">{value}</div>
    </div>
  );
}
