import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, Power, Save, Trash2 } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Button, Card, DataTable, Modal, Spinner, TextField } from "../../components/ui";
import { StatCards, StatusPill } from "../../components/segment/kit";
import { useLang } from "../../context/LangContext";
import {
  CONFIG_DOMAINS,
  getTenant,
  getTenantConfig,
  listConfigAudit,
  setTenantStatus,
  updateTenant,
  updateTenantConfig,
  type AuditRow,
  type ConfigDomain,
  type TenantConfig,
  type TenantDetail,
} from "../../api/platform";

function statusTone(s: string) {
  return s === "active" ? "green" : s === "suspended" ? "red" : "gray";
}

// 把任意值转为可编辑字符串
function toEditable(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
// 编辑字符串转回值：优先 JSON，失败则原样字符串
function fromEditable(s: string): any {
  const t = s.trim();
  if (t === "") return "";
  try {
    return JSON.parse(t);
  } catch {
    return s;
  }
}

export default function TenantDetailPage() {
  const { tr } = useLang();
  const { id } = useParams();
  const tenantId = Number(id);
  const navigate = useNavigate();

  const AUDIT_COL = {
    time: tr("时间", "Time"),
    actor: tr("操作者", "Actor"),
    action: tr("动作", "Action"),
    target: tr("对象", "Object"),
    reason: tr("原因", "Reason"),
  };

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [config, setConfig] = useState<TenantConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<ConfigDomain>("基础");
  const [editOpen, setEditOpen] = useState(false);
  const [audits, setAudits] = useState<AuditRow[] | null>(null);

  function reload() {
    setErr(null);
    Promise.all([getTenant(tenantId), getTenantConfig(tenantId)])
      .then(([t, c]) => {
        setTenant(t);
        setConfig(c);
      })
      .catch((e) => setErr(String(e?.response?.data?.detail || e)));
    listConfigAudit({ tenant_id: tenantId, limit: 50 })
      .then((r) => setAudits(r.audits))
      .catch(() => setAudits([]));
  }

  useEffect(() => {
    if (!Number.isFinite(tenantId)) return;
    setTenant(null);
    setConfig(null);
    reload();
  }, [tenantId]);

  async function toggleStatus() {
    if (!tenant) return;
    const next = tenant.status === "active" ? "suspended" : "active";
    const reason = window.prompt(
      next === "suspended"
        ? tr("确认停用该租户？可填写原因：", "Suspend this tenant? You may enter a reason:")
        : tr("确认启用该租户？可填写原因：", "Enable this tenant? You may enter a reason:"),
      ""
    );
    if (reason === null) return;
    try {
      await setTenantStatus(tenantId, next, reason || undefined);
      reload();
    } catch (e: any) {
      setErr(String(e?.response?.data?.detail || e));
    }
  }

  if (err && !tenant) {
    return (
      <Layout title={tr("租户详情", "Tenant Detail")} subtitle={`#${tenantId}`}>
        <Card className="p-5 text-sm text-red-600">{err}</Card>
      </Layout>
    );
  }
  if (!tenant || !config) {
    return (
      <Layout title={tr("租户详情", "Tenant Detail")} subtitle={`#${tenantId}`}>
        <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>
      </Layout>
    );
  }

  return (
    <Layout
      title={tenant.tenant_name}
      subtitle={
        <span className="flex items-center gap-2">
          <span>#{tenant.tenant_id}</span>
          <StatusPill tone={statusTone(tenant.status)}>{tenant.status}</StatusPill>
          <span className="text-gray-400">·</span>
          <span>{tenant.tier} / {tenant.scale_tier}</span>
        </span>
      }
      actions={
        <>
          <Button variant="ghost" onClick={() => navigate("/settings/tenants")}>
            <ArrowLeft className="h-4 w-4" /> {tr("返回", "Back")}
          </Button>
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4" /> {tr("编辑基础信息", "Edit Basic Info")}
          </Button>
          <Button variant={tenant.status === "active" ? "outline" : "primary"} onClick={toggleStatus}>
            <Power className="h-4 w-4" /> {tenant.status === "active" ? tr("停用", "Suspend") : tr("启用", "Enable")}
          </Button>
        </>
      }
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      <StatCards
        items={[
          { label: tr("近24h事件", "Events (24h)"), value: tenant.events_24h },
          { label: "Kafka Topic", value: <span className="text-base">{tenant.kafka_topic || "—"}</span> },
          { label: tr("联系人", "Contact"), value: <span className="text-base">{tenant.contact_email || "—"}</span> },
          { label: tr("配置项总数", "Total Config Items"), value: Object.values(tenant.config_summary || {}).reduce((a, b) => a + b, 0) },
        ]}
      />

      {/* 配置域 Tab */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-gray-200">
        {CONFIG_DOMAINS.map((d) => (
          <button
            key={d}
            onClick={() => setTab(d)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === d ? "border-brand-500 text-brand-700" : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {d}
            {tenant.config_summary?.[d] ? (
              <span className="ml-1 text-xs text-gray-400">({tenant.config_summary[d]})</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "基础" ? (
        <BasicDomainCard config={config["基础"] || {}} />
      ) : (
        <DomainEditor
          tenantId={tenantId}
          domain={tab}
          values={config[tab] || {}}
          onSaved={reload}
        />
      )}

      {/* 配置变更审计 */}
      <div className="mb-3 mt-8 text-base font-semibold text-gray-900">{tr("配置变更审计 Audit Trail", "Config Change Audit Trail")}</div>
      <Card className="p-2">
        {!audits ? (
          <div className="flex items-center gap-2 p-4 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>
        ) : (
          <DataTable
            columns={[AUDIT_COL.time, AUDIT_COL.actor, AUDIT_COL.action, AUDIT_COL.target, AUDIT_COL.reason]}
            rows={audits.map((a) => ({
              [AUDIT_COL.time]: a.created_at,
              [AUDIT_COL.actor]: a.actor,
              [AUDIT_COL.action]: a.action,
              [AUDIT_COL.target]: a.target,
              [AUDIT_COL.reason]: a.reason || "—",
            }))}
          />
        )}
      </Card>

      <EditBasicModal
        open={editOpen}
        tenant={tenant}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          reload();
        }}
      />
    </Layout>
  );
}

function BasicDomainCard({ config }: { config: Record<string, any> }) {
  const { tr } = useLang();
  const rows = Object.entries(config);
  return (
    <Card className="p-6">
      <div className="mb-1 text-base font-semibold text-gray-900">{tr("基础信息", "Basic Info")}</div>
      <div className="mb-4 text-sm text-gray-500">{tr("基础域恒由 tenants 主表派生，请用「编辑基础信息」修改。", "The Basic domain is always derived from the tenants master table; use \"Edit Basic Info\" to modify.")}</div>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 border-b border-gray-100 py-2">
            <dt className="text-sm text-gray-500">{k}</dt>
            <dd className="text-sm font-medium text-gray-900">{v == null || v === "" ? "—" : String(v)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

interface KV { key: string; value: string }

function DomainEditor({
  tenantId, domain, values, onSaved,
}: {
  tenantId: number; domain: ConfigDomain; values: Record<string, any>; onSaved: () => void;
}) {
  const { tr } = useLang();
  const [rows, setRows] = useState<KV[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // 切换域时重置编辑态
  useEffect(() => {
    setRows(Object.entries(values).map(([key, v]) => ({ key, value: toEditable(v) })));
    setReason("");
    setErr(null);
    setOk(null);
  }, [domain, JSON.stringify(values)]);

  function setRow(i: number, patch: Partial<KV>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, { key: "", value: "" }]);
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function save() {
    const updates: Record<string, any> = {};
    for (const r of rows) {
      const k = r.key.trim();
      if (!k) continue;
      updates[k] = fromEditable(r.value);
    }
    if (Object.keys(updates).length === 0) {
      setErr(tr("请至少填写一个配置项", "Please fill in at least one config item"));
      return;
    }
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      const r = await updateTenantConfig(tenantId, {
        domain,
        updates,
        reason: reason || undefined,
      });
      setOk(tr(`已更新 ${r.updated_keys.length} 项`, `Updated ${r.updated_keys.length} item(s)`));
      onSaved();
    } catch (e: any) {
      setErr(String(e?.response?.data?.detail || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-base font-semibold text-gray-900">{domain} {tr("配置", "Config")}</div>
        <Button variant="outline" onClick={addRow}>
          <Plus className="h-4 w-4" /> {tr("新增配置项", "Add Config Item")}
        </Button>
      </div>
      <div className="mb-4 text-sm text-gray-500">{tr("值支持纯文本或 JSON（如 8、true、", "Values support plain text or JSON (e.g. 8, true, ")}{"{\"a\":1}"}{tr("）。", "). ")}</div>

      <div className="space-y-2">
        {rows.length === 0 && <div className="py-6 text-center text-sm text-gray-400">{tr("暂无配置项，点「新增配置项」添加。", "No config items yet. Click \"Add Config Item\" to add one.")}</div>}
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="w-1/3 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={r.key}
              placeholder="config_key"
              onChange={(e) => setRow(i, { key: e.target.value })}
            />
            <input
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={r.value}
              placeholder="config_value"
              onChange={(e) => setRow(i, { value: e.target.value })}
            />
            <Button variant="ghost" onClick={() => removeRow(i)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <TextField label={tr("变更原因（写入审计）", "Change Reason (logged to audit)")} value={reason} onChange={setReason} placeholder={tr("可选", "Optional")} />
      </div>

      {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
      {ok && <div className="mt-3 text-sm text-brand-600">{ok}</div>}

      <div className="mt-4 flex justify-end">
        <Button onClick={save} disabled={busy}>
          {busy ? <Spinner /> : <Save className="h-4 w-4" />} {tr("保存配置", "Save Config")}
        </Button>
      </div>
    </Card>
  );
}

function EditBasicModal({
  open, tenant, onClose, onSaved,
}: { open: boolean; tenant: TenantDetail; onClose: () => void; onSaved: () => void }) {
  const { tr } = useLang();
  const [name, setName] = useState(tenant.tenant_name);
  const [tier, setTier] = useState(tenant.tier);
  const [scale, setScale] = useState(tenant.scale_tier);
  const [email, setEmail] = useState(tenant.contact_email || "");
  const [desc, setDesc] = useState(tenant.description || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 打开时同步当前值
  useEffect(() => {
    if (open) {
      setName(tenant.tenant_name);
      setTier(tenant.tier);
      setScale(tenant.scale_tier);
      setEmail(tenant.contact_email || "");
      setDesc(tenant.description || "");
      setErr(null);
    }
  }, [open, tenant]);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await updateTenant(tenant.tenant_id, {
        tenant_name: name.trim(),
        tier,
        scale_tier: scale,
        contact_email: email || null,
        description: desc || null,
      });
      onSaved();
    } catch (e: any) {
      setErr(String(e?.response?.data?.detail || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={tr("编辑基础信息", "Edit Basic Info")} onClose={onClose}>
      <div className="space-y-4">
        <TextField label={tr("租户名称", "Tenant Name")} value={name} onChange={setName} />
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{tr("档位 tier", "Tier")}</span>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={tier}
              onChange={(e) => setTier(e.target.value)}
            >
              {["standard", "premium"].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{tr("规模 scale", "Scale")}</span>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={scale}
              onChange={(e) => setScale(e.target.value)}
            >
              {["dev", "medium", "large", "xlarge"].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        </div>
        <TextField label={tr("联系人邮箱", "Contact Email")} value={email} onChange={setEmail} />
        <TextField label={tr("描述", "Description")} value={desc} onChange={setDesc} />
        {err && <div className="text-sm text-red-600">{err}</div>}
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>{tr("取消", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <Save className="h-4 w-4" />} {tr("保存", "Save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
