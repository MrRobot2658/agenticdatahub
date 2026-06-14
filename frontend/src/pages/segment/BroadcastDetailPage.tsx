import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Send, Trash2 } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable, Spinner, Badge } from "../../components/ui";
import { StatCards, StatusPill } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import {
  getBroadcast, getBroadcastStats, listBroadcastSends, sendBroadcast, deleteBroadcast,
  type Broadcast, type BroadcastStats, type BroadcastSend, type BroadcastStatus, type ChannelType,
} from "../../api/engage";

const STATUS_TONE: Record<BroadcastStatus, "green" | "amber" | "gray" | "blue" | "red"> = {
  sent: "green", sending: "blue", scheduled: "amber", draft: "gray", failed: "red",
};
const STATUS_LABEL = (tr: (zh: string, en?: string) => string): Record<BroadcastStatus, string> => ({
  sent: tr("已发送", "Sent"), sending: tr("发送中", "Sending"), scheduled: tr("已排程", "Scheduled"), draft: tr("草稿", "Draft"), failed: tr("失败", "Failed"),
});
const CHANNEL_LABEL = (tr: (zh: string, en?: string) => string): Record<ChannelType, string> => ({
  email: "EDM", sms: tr("短信", "SMS"), push: "Push", wechat: tr("微信", "WeChat"),
});

export default function BroadcastDetailPage() {
  const { id } = useParams();
  const broadcastId = Number(id);
  const { tenant } = useTenant();
  const { tr } = useLang();
  const navigate = useNavigate();
  const statusLabel = STATUS_LABEL(tr);
  const channelLabel = CHANNEL_LABEL(tr);

  const [bc, setBc] = useState<Broadcast | null>(null);
  const [stats, setStats] = useState<BroadcastStats | null>(null);
  const [sends, setSends] = useState<BroadcastSend[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    setErr(null);
    getBroadcast(tenant, broadcastId).then(setBc).catch((e) => setErr(String(e)));
    getBroadcastStats(tenant, broadcastId).then(setStats).catch(() => {});
    listBroadcastSends(tenant, broadcastId).then(setSends).catch(() => {});
  }
  useEffect(reload, [tenant, broadcastId]);

  async function onSend() {
    if (!confirm(tr("确认发送该群发任务？", "Send this broadcast?"))) return;
    setBusy(true);
    try {
      const updated = await sendBroadcast(tenant, broadcastId);
      setBc(updated);
      reload();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function onDelete() {
    if (!confirm(tr("确认删除该群发任务？将同时删除发送回执。", "Delete this broadcast? Send receipts will be deleted as well."))) return;
    setBusy(true);
    try {
      await deleteBroadcast(tenant, broadcastId);
      navigate("/engage/broadcasts");
    } catch (e) { setErr(String(e)); setBusy(false); }
  }

  const COL = {
    oneId: "OneID",
    status: tr("状态", "Status"),
    sentAt: tr("发送时间", "Sent at"),
    openedAt: tr("打开时间", "Opened at"),
    clickedAt: tr("点击时间", "Clicked at"),
  };
  const sendRows = (sends || []).map((s) => ({
    [COL.oneId]: s.one_id || "—",
    [COL.status]: s.status,
    [COL.sentAt]: s.sent_at || "—",
    [COL.openedAt]: s.opened_at || "—",
    [COL.clickedAt]: s.clicked_at || "—",
  }));

  const canSend = bc && (bc.status === "draft" || bc.status === "scheduled");

  return (
    <Layout
      title={bc ? (bc.broadcast_name || bc.broadcast_code) : tr("群发详情", "Broadcast Detail")}
      subtitle={bc?.subject || bc?.broadcast_code || ""}
      actions={bc && (
        <div className="flex items-center gap-2">
          <StatusPill tone={STATUS_TONE[bc.status] ?? "gray"}>
            {statusLabel[bc.status] ?? bc.status}
          </StatusPill>
          {canSend && (
            <Button onClick={onSend} disabled={busy}><Send className="h-4 w-4" /> {tr("发送", "Send")}</Button>
          )}
          <Button variant="ghost" onClick={onDelete} disabled={busy}>
            <Trash2 className="h-4 w-4" /> {tr("删除", "Delete")}
          </Button>
        </div>
      )}
    >
      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!bc && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {bc && (
        <>
          <StatCards items={[
            { label: tr("总发送", "Total Sent"), value: (stats?.total ?? 0).toLocaleString() },
            { label: tr("已送达", "Delivered"), value: (stats?.delivered ?? 0).toLocaleString() },
            { label: tr("打开", "Opened"), value: (stats?.opened_any ?? 0).toLocaleString() },
            { label: tr("点击", "Clicked"), value: (stats?.clicked_any ?? 0).toLocaleString() },
          ]} />

          <Card className="mb-6 p-5">
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <Info label={tr("渠道", "Channel")} value={bc.channel_type ? (channelLabel[bc.channel_type] ?? bc.channel_type) : "—"} />
              <Info label={tr("预估受众", "Estimated Audience")} value={(bc.estimated_size ?? 0).toLocaleString()} />
              <Info label={tr("关联受众 ID", "Linked Audience ID")} value={bc.segment_id ?? "—"} />
              <Info label={tr("目的地", "Destination")} value={bc.destination_id ?? "—"} />
              <Info label={tr("排程时间", "Scheduled at")} value={bc.scheduled_at ?? "—"} />
              <Info label={tr("发送时间", "Sent at")} value={bc.sent_at ?? "—"} />
            </div>
          </Card>

          <Card className="p-2">
            <div className="flex items-center justify-between px-3 pb-2 pt-3">
              <div className="text-sm font-semibold text-gray-700">
                {tr("发送回执", "Send Receipts")} <span className="ml-2 font-normal text-gray-400">· {tr("最近 100 条", "Latest 100")}</span>
              </div>
              <Badge color="brand">{tr(`${sends?.length ?? 0} 条`, `${sends?.length ?? 0}`)}</Badge>
            </div>
            <DataTable columns={[COL.oneId, COL.status, COL.sentAt, COL.openedAt, COL.clickedAt]} rows={sendRows} />
          </Card>
        </>
      )}
    </Layout>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-gray-900">{value}</div>
    </div>
  );
}
