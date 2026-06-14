import { useEffect, useState } from "react";
import { Plus, Send } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable, Spinner, Modal, TextField } from "../../components/ui";
import { StatCards, EmptyState, StatusPill } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import {
  listBroadcasts, createBroadcast, type Broadcast, type BroadcastStatus, type ChannelType,
} from "../../api/engage";

const STATUS_TONE: Record<BroadcastStatus, "green" | "amber" | "gray" | "blue" | "red"> = {
  sent: "green", sending: "blue", scheduled: "amber", draft: "gray", failed: "red",
};

export default function BroadcastsPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const STATUS_LABEL: Record<BroadcastStatus, string> = {
    sent: tr("已发送", "Sent"), sending: tr("发送中", "Sending"), scheduled: tr("已排程", "Scheduled"),
    draft: tr("草稿", "Draft"), failed: tr("失败", "Failed"),
  };
  const CHANNEL_LABEL: Record<ChannelType, string> = {
    email: tr("EDM", "EDM"), sms: tr("短信", "SMS"), push: tr("Push", "Push"), wechat: tr("微信", "WeChat"),
  };
  const COL = {
    name: tr("名称", "Name"),
    channel: tr("渠道", "Channel"),
    subject: tr("主题", "Subject"),
    audience: tr("预估受众", "Estimated audience"),
    status: tr("状态", "Status"),
  };
  const [rows, setRows] = useState<Broadcast[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<ChannelType>("email");
  const [subject, setSubject] = useState("");
  const [saving, setSaving] = useState(false);

  function reload() {
    setRows(null); setErr(null);
    listBroadcasts(tenant).then(setRows).catch((e) => setErr(String(e)));
  }
  useEffect(reload, [tenant]);

  async function onCreate() {
    if (!code.trim()) return;
    setSaving(true);
    try {
      await createBroadcast({
        tenant_id: tenant,
        broadcast_code: code.trim(),
        broadcast_name: name.trim() || code.trim(),
        channel_type: channel,
        subject: subject.trim() || undefined,
      });
      setOpen(false); setCode(""); setName(""); setSubject("");
      reload();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || String(e));
    } finally {
      setSaving(false);
    }
  }

  const view = (rows || []).map((b) => ({
    [COL.name]: b.broadcast_name || b.broadcast_code,
    [COL.channel]: b.channel_type ? (CHANNEL_LABEL[b.channel_type] ?? b.channel_type) : "—",
    [COL.subject]: b.subject || "—",
    [COL.audience]: (b.estimated_size ?? 0).toLocaleString(),
    [COL.status]: <StatusPill tone={STATUS_TONE[b.status] ?? "gray"}>{STATUS_LABEL[b.status] ?? b.status}</StatusPill>,
    _id: b.broadcast_id,
  }));

  return (
    <Layout
      title={tr("群发 Broadcasts", "Broadcasts")}
      subtitle={tr("面向受众的一次性群发触达，支持 Push、短信、微信与 EDM", "One-time broadcast outreach to your audiences across Push, SMS, WeChat, and EDM")}
      actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {tr("新建群发", "New broadcast")}</Button>}
    >
      {err && <Card className="mb-4 p-5 text-sm text-red-600">{err}</Card>}
      {!rows && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}

      {rows && (
        <>
          <StatCards items={[
            { label: tr("群发任务", "Broadcasts"), value: rows.length },
            { label: tr("已发送", "Sent"), value: rows.filter((b) => b.status === "sent").length },
            { label: tr("发送中", "Sending"), value: rows.filter((b) => b.status === "sending").length },
            { label: tr("预估总触达", "Estimated total reach"), value: rows.reduce((a, b) => a + (b.estimated_size || 0), 0).toLocaleString() },
          ]} />
          {rows.length === 0 ? (
            <EmptyState
              icon={Send}
              title={tr("还没有群发任务", "No broadcasts yet")}
              desc={tr("选择一个受众与渠道，创建一次性群发触达。", "Pick an audience and a channel to create a one-time broadcast.")}
              action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {tr("新建第一个群发", "Create your first broadcast")}</Button>}
            />
          ) : (
            <Card className="p-2">
              <DataTable
                columns={[COL.name, COL.channel, COL.subject, COL.audience, COL.status]}
                rows={view}
                rowLink={(r) => `/engage/broadcasts/${r._id}`}
              />
            </Card>
          )}
        </>
      )}

      <Modal open={open} title={tr("新建群发", "New broadcast")} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label={tr("群发标识（broadcast_code，唯一）", "Broadcast code (broadcast_code, unique)")} value={code} onChange={setCode} placeholder={tr("如 spring_sale", "e.g. spring_sale")} />
          <TextField label={tr("群发名称", "Broadcast name")} value={name} onChange={setName} placeholder={tr("春季大促群发", "Spring sale broadcast")} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{tr("渠道", "Channel")}</span>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={channel}
              onChange={(e) => setChannel(e.target.value as ChannelType)}
            >
              <option value="email">{tr("EDM 邮件", "EDM Email")}</option>
              <option value="sms">{tr("短信", "SMS")}</option>
              <option value="push">{tr("Push", "Push")}</option>
              <option value="wechat">{tr("微信", "WeChat")}</option>
            </select>
          </label>
          <TextField label={tr("主题", "Subject")} value={subject} onChange={setSubject} placeholder={tr("限时优惠，错过再等一年", "Limited-time offer — don't miss out")} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button onClick={onCreate} disabled={saving || !code.trim()}>
              {saving ? tr("创建中…", "Creating…") : tr("创建", "Create")}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
