import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Play, Trash2, BellRing, Check, CheckCheck } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Button, Spinner, Badge, Modal, TextField } from "../components/ui";
import { StatCards, StatusPill } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import {
  listAlertRules,
  createAlertRule,
  deleteAlertRule,
  evaluateAlertRule,
  listAlertEvents,
  acknowledgeAlertEvent,
  resolveAlertEvent,
  type AlertRule,
  type AlertEvent,
  type AlertMetric,
  type AlertOperator,
  type AlertSeverity,
} from "../api/monitor";

// 严重级别颜色映射（非可见文案，仅用于样式着色）
const SEVERITY_COLORS: Record<string, string> = {
  high: "red",
  medium: "amber",
  low: "gray",
};
const sevColor = (v: string) => SEVERITY_COLORS[v] || "gray";

type Tr = (zh: string, en: string) => string;
const buildMetrics = (tr: Tr): { value: AlertMetric; label: string }[] => [
  { value: "success_rate", label: tr("成功率(%)", "Success rate (%)") },
  { value: "error_rate", label: tr("错误率(%)", "Error rate (%)") },
  { value: "event_count", label: tr("事件量", "Event count") },
  { value: "latency_p95", label: tr("P95 时延(ms)", "P95 latency (ms)") },
];
const buildOperators = (tr: Tr): { value: AlertOperator; label: string }[] => [
  { value: "lt", label: tr("小于 <", "Less than <") },
  { value: "lte", label: tr("小于等于 ≤", "Less or equal ≤") },
  { value: "gt", label: tr("大于 >", "Greater than >") },
  { value: "gte", label: tr("大于等于 ≥", "Greater or equal ≥") },
  { value: "eq", label: tr("等于 =", "Equal =") },
];
const buildSeverities = (tr: Tr): { value: AlertSeverity; label: string; color: string }[] => [
  { value: "high", label: tr("高", "High"), color: "red" },
  { value: "medium", label: tr("中", "Medium"), color: "amber" },
  { value: "low", label: tr("低", "Low"), color: "gray" },
];

function Select({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <select
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function eventTone(s: string): "amber" | "blue" | "green" | "gray" {
  if (s === "triggered") return "amber";
  if (s === "acknowledged") return "blue";
  if (s === "resolved") return "green";
  return "gray";
}
export default function MonitorAlertsPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const METRICS = buildMetrics(tr);
  const OPERATORS = buildOperators(tr);
  const SEVERITIES = buildSeverities(tr);
  const metricLabel = (v: string) => METRICS.find((m) => m.value === v)?.label || v;
  const opLabel = (v: string) => OPERATORS.find((o) => o.value === v)?.label || v;
  const sevLabel = (v: string) => SEVERITIES.find((s) => s.value === v)?.label || v;
  const eventStatusLabel: Record<string, string> = {
    triggered: tr("已触发", "Triggered"),
    acknowledged: tr("已确认", "Acknowledged"),
    resolved: tr("已解决", "Resolved"),
  };
  const [tab, setTab] = useState<"rules" | "events">("rules");
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [events, setEvents] = useState<AlertEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 新建规则表单
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [metric, setMetric] = useState<string>("success_rate");
  const [operator, setOperator] = useState<string>("lt");
  const [threshold, setThreshold] = useState("95");
  const [windowMin, setWindowMin] = useState("5");
  const [channel, setChannel] = useState("feishu");
  const [severity, setSeverity] = useState<string>("medium");
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    Promise.all([listAlertRules(tenant), listAlertEvents(tenant, { limit: 100 })])
      .then(([r, e]) => {
        setRules(r);
        setEvents(e);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [tenant]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createAlertRule(tenant, {
        name: name.trim(),
        metric,
        operator,
        threshold: Number(threshold),
        window_minutes: Number(windowMin) || 5,
        channel: channel.trim() || "feishu",
        severity,
        enabled: true,
      });
      setOpen(false);
      setName("");
      load();
      flash(tr("告警规则已创建", "Alert rule created"));
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm(tr("确认删除该告警规则？关联触发记录会一并删除。", "Delete this alert rule? Its triggered events will be removed too."))) return;
    setBusy(id);
    try {
      await deleteAlertRule(tenant, id);
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const evaluate = async (id: number) => {
    setBusy(id);
    try {
      const r = await evaluateAlertRule(tenant, id, true);
      flash(
        r.breached
          ? tr(`已触发：${metricLabel(r.metric)} 当前 ${r.metric_value ?? "—"}`, `Triggered: ${metricLabel(r.metric)} now ${r.metric_value ?? "—"}`)
          : tr(`未越界：${metricLabel(r.metric)} 当前 ${r.metric_value ?? "—"}`, `Within threshold: ${metricLabel(r.metric)} now ${r.metric_value ?? "—"}`),
      );
      if (r.breached) load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const ack = async (id: number) => {
    setBusy(id);
    try {
      await acknowledgeAlertEvent(tenant, id, "console");
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (id: number) => {
    setBusy(id);
    try {
      await resolveAlertEvent(tenant, id);
      load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const triggered = (events || []).filter((e) => e.status === "triggered").length;

  return (
    <Layout
      title={tr("告警 Alerts", "Alerts")}
      subtitle={tr("为投递成功率、事件量、错误率与时延设置阈值，越界即触发（来自 /monitor/alert-rules · /alert-events）", "Set thresholds on delivery success rate, event count, error rate and latency; breaching them triggers an alert (from /monitor/alert-rules · /alert-events)")}
      actions={
        <>
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? <Spinner /> : <RefreshCw className="h-4 w-4" />} {tr("刷新", "Refresh")}
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> {tr("新建告警", "New alert")}
          </Button>
        </>
      }
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}
      {toast && (
        <Card className="mb-4 border-brand-200 bg-brand-50 p-3 text-sm text-brand-700">{toast}</Card>
      )}

      <StatCards
        items={[
          { label: tr("告警规则", "Alert rules"), value: rules ? rules.length : "…" },
          { label: tr("已启用", "Enabled"), value: rules ? rules.filter((r) => r.enabled).length : "…" },
          { label: tr("触发记录", "Triggered events"), value: events ? events.length : "…" },
          { label: tr("待处理", "Pending"), value: events ? triggered : "…", tone: triggered ? "red" : "green" },
        ]}
      />

      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {([
          ["rules", tr("告警规则", "Alert rules")],
          ["events", tr("触发记录", "Triggered events")],
        ] as const).map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === k ? "border-brand-500 text-brand-700" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {tab === "rules" && (
        <Card className="p-2">
          {!rules ? (
            <div className="flex items-center gap-2 px-3 py-6 text-gray-500">
              <Spinner /> {tr("加载中…", "Loading…")}
            </div>
          ) : (
            <DataTable
              columns={[
                tr("规则", "Rule"),
                tr("条件", "Condition"),
                tr("窗口", "Window"),
                tr("渠道", "Channel"),
                tr("级别", "Severity"),
                tr("状态", "Status"),
                tr("操作", "Actions"),
              ]}
              rows={rules.map((r) => ({
                [tr("规则", "Rule")]: r.name,
                [tr("条件", "Condition")]: `${metricLabel(r.metric)} ${opLabel(r.operator)} ${r.threshold}`,
                [tr("窗口", "Window")]: tr(`${r.window_minutes} 分钟`, `${r.window_minutes} min`),
                [tr("渠道", "Channel")]: r.channel,
                [tr("级别", "Severity")]: <Badge color={sevColor(r.severity)}>{sevLabel(r.severity)}</Badge>,
                [tr("状态", "Status")]: r.enabled ? <Badge color="green">{tr("启用", "Enabled")}</Badge> : <Badge>{tr("停用", "Disabled")}</Badge>,
                [tr("操作", "Actions")]: (
                  <div className="flex gap-1">
                    <Button variant="ghost" onClick={() => evaluate(r.id)} disabled={busy === r.id}>
                      {busy === r.id ? <Spinner /> : <Play className="h-3.5 w-3.5" />} {tr("评估", "Evaluate")}
                    </Button>
                    <Button variant="ghost" onClick={() => remove(r.id)} disabled={busy === r.id}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ),
              }))}
            />
          )}
        </Card>
      )}

      {tab === "events" && (
        <Card className="p-2">
          {!events ? (
            <div className="flex items-center gap-2 px-3 py-6 text-gray-500">
              <Spinner /> {tr("加载中…", "Loading…")}
            </div>
          ) : (
            <DataTable
              columns={[
                tr("触发时间", "Fired at"),
                tr("规则", "Rule"),
                tr("指标", "Metric"),
                tr("指标值", "Value"),
                tr("状态", "Status"),
                tr("确认人", "Acknowledged by"),
                tr("操作", "Actions"),
              ]}
              rows={events.map((e) => ({
                [tr("触发时间", "Fired at")]: e.fired_at,
                [tr("规则", "Rule")]: e.rule_name || `#${e.rule_id}`,
                [tr("指标", "Metric")]: e.metric ? metricLabel(e.metric) : "—",
                [tr("指标值", "Value")]: e.metric_value ?? "—",
                [tr("状态", "Status")]: <StatusPill tone={eventTone(e.status)}>{eventStatusLabel[e.status] || e.status}</StatusPill>,
                [tr("确认人", "Acknowledged by")]: e.acknowledged_by || "—",
                [tr("操作", "Actions")]: (
                  <div className="flex gap-1">
                    {e.status === "triggered" && (
                      <Button variant="ghost" onClick={() => ack(e.id)} disabled={busy === e.id}>
                        {busy === e.id ? <Spinner /> : <Check className="h-3.5 w-3.5" />} {tr("确认", "Acknowledge")}
                      </Button>
                    )}
                    {e.status !== "resolved" && (
                      <Button variant="ghost" onClick={() => resolve(e.id)} disabled={busy === e.id}>
                        <CheckCheck className="h-3.5 w-3.5" /> {tr("解决", "Resolve")}
                      </Button>
                    )}
                    {e.status === "resolved" && <span className="px-2 text-xs text-gray-400">{tr("已闭环", "Closed")}</span>}
                  </div>
                ),
              }))}
            />
          )}
        </Card>
      )}

      <Modal open={open} title={tr("新建告警规则", "New alert rule")} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label={tr("规则名称", "Rule name")} value={name} onChange={setName} placeholder={tr("如 成功率跌破 95%", "e.g. Success rate drops below 95%")} />
          <div className="grid grid-cols-2 gap-3">
            <Select label={tr("监控指标", "Metric")} value={metric} onChange={setMetric} options={METRICS} />
            <Select label={tr("比较", "Comparison")} value={operator} onChange={setOperator} options={OPERATORS} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label={tr("阈值", "Threshold")} value={threshold} onChange={setThreshold} placeholder={tr("如 95", "e.g. 95")} />
            <TextField label={tr("窗口（分钟）", "Window (minutes)")} value={windowMin} onChange={setWindowMin} placeholder="5" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label={tr("通知渠道", "Notify channel")} value={channel} onChange={setChannel} placeholder="feishu / email / webhook" />
            <Select label={tr("级别", "Severity")} value={severity} onChange={setSeverity} options={SEVERITIES} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button onClick={save} disabled={saving || !name.trim()}>
              {saving ? <Spinner /> : <BellRing className="h-4 w-4" />} {tr("保存", "Save")}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
