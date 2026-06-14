import { useCallback, useEffect, useState } from "react";
import { Plus, Play, Search, ShieldAlert } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Button, Spinner, Badge, Modal, TextField } from "../components/ui";
import { StatCards } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import {
  listDeletionRequests,
  createDeletionRequest,
  executeDeletion,
  getDeletionRequest,
  checkSuppression,
  type DeletionRequest,
  type PrivacyAuditLog,
  type SuppressionResult,
} from "../api/privacy";

type Tr = (zh: string, en?: string) => string;
const STATUS_COLOR: Record<string, string> = { pending: "amber", processing: "brand", completed: "green" };
const typeLabel = (tr: Tr, t: string): string =>
  ({ delete: tr("删除", "Delete"), suppress: tr("抑制", "Suppress"), both: tr("删除+抑制", "Delete + Suppress") } as Record<string, string>)[t] || t;
const statusLabel = (tr: Tr, s: string): string =>
  ({ pending: tr("待处理", "Pending"), processing: tr("处理中", "Processing"), completed: tr("已完成", "Completed") } as Record<string, string>)[s] || s;

export default function PrivacyDeletionPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [reqs, setReqs] = useState<DeletionRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  // 新建工单
  const [open, setOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [reason, setReason] = useState("");
  const [rtype, setRtype] = useState<"delete" | "suppress" | "both">("delete");
  const [saving, setSaving] = useState(false);

  // 工单详情
  const [detail, setDetail] = useState<(DeletionRequest & { audit_log: PrivacyAuditLog[] }) | null>(null);

  // 抑制校验
  const [supId, setSupId] = useState("");
  const [supRes, setSupRes] = useState<SuppressionResult | null>(null);
  const [supBusy, setSupBusy] = useState(false);

  const load = useCallback(() => {
    setReqs(null); setErr(null);
    listDeletionRequests(tenant).then((r) => setReqs(r.requests)).catch((e) => setErr(String(e)));
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!identifier.trim()) return;
    setSaving(true);
    try {
      await createDeletionRequest({
        tenant_id: tenant,
        identifier: identifier.trim(),
        request_type: rtype,
        reason: reason.trim() || undefined,
        created_by: "console",
      });
      setOpen(false); setIdentifier(""); setReason(""); setRtype("delete");
      load();
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  };

  const execute = async (r: DeletionRequest) => {
    if (!window.confirm(tr(`确认执行工单 #${r.request_id}？删除不可逆。`, `Execute request #${r.request_id}? Deletion is irreversible.`))) return;
    setBusy(r.request_id);
    try {
      await executeDeletion(tenant, r.request_id, true);
      load();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  };

  const view = async (r: DeletionRequest) => {
    try { setDetail(await getDeletionRequest(tenant, r.request_id)); }
    catch (e) { setErr(String(e)); }
  };

  const checkSup = async () => {
    if (!supId.trim()) return;
    setSupBusy(true); setSupRes(null);
    try {
      const idNum = Number(supId);
      const res = Number.isFinite(idNum) && String(idNum) === supId.trim()
        ? await checkSuppression(tenant, { one_id: idNum })
        : await checkSuppression(tenant, { identifier: supId.trim() });
      setSupRes(res);
    } catch (e) { setErr(String(e)); }
    finally { setSupBusy(false); }
  };

  return (
    <Layout
      title={tr("删除与抑制 Deletion & Suppression", "Deletion & Suppression")}
      subtitle={tr("处理 GDPR 删除/抑制工单，跟踪每个数据主体的执行回执（来自 /privacy/deletion）", "Process GDPR deletion/suppression requests and track per-subject execution receipts (from /privacy/deletion)")}
      actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {tr("新建工单", "New Request")}</Button>}
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      <StatCards items={[
        { label: tr("工单总数", "Total Requests"), value: reqs ? reqs.length : "…" },
        { label: tr("待处理", "Pending"), value: reqs ? reqs.filter((r) => r.status === "pending").length : "…" },
        { label: tr("已完成", "Completed"), value: reqs ? reqs.filter((r) => r.status === "completed").length : "…" },
        { label: tr("影响记录数", "Affected Records"), value: reqs ? reqs.reduce((a, r) => a + (r.affected_count || 0), 0) : "…" },
      ]} />

      {!reqs && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}
      {reqs && (() => {
        const COL = {
          id: tr("工单ID", "Request ID"),
          identifier: tr("标识符", "Identifier"),
          type: tr("类型", "Type"),
          status: tr("状态", "Status"),
          affected: tr("影响数", "Affected"),
          createdAt: tr("提交时间", "Submitted At"),
          actions: tr("操作", "Actions"),
        };
        return (
        <Card className="mb-6 p-2">
          <div className="px-3 py-2 text-sm font-medium text-gray-700">{tr("删除/抑制工单", "Deletion / Suppression Requests")}</div>
          <DataTable
            columns={[COL.id, COL.identifier, COL.type, COL.status, COL.affected, COL.createdAt, COL.actions]}
            rows={reqs.map((r) => ({
              [COL.id]: <button className="text-brand-600 hover:underline" onClick={() => view(r)}>#{r.request_id}</button>,
              [COL.identifier]: r.identifier || (r.one_id != null ? `one_id:${r.one_id}` : "—"),
              [COL.type]: typeLabel(tr, r.request_type),
              [COL.status]: <Badge color={STATUS_COLOR[r.status] || "gray"}>{statusLabel(tr, r.status)}</Badge>,
              [COL.affected]: r.affected_count ?? "—",
              [COL.createdAt]: r.created_at || "—",
              [COL.actions]: r.status === "completed" ? (
                <span className="text-xs text-gray-400">{tr("已执行", "Executed")}</span>
              ) : (
                <Button variant="outline" onClick={() => execute(r)} disabled={busy === r.request_id}>
                  {busy === r.request_id ? <Spinner /> : <Play className="h-3.5 w-3.5" />} {tr("执行", "Execute")}
                </Button>
              ),
            }))}
          />
        </Card>
        );
      })()}

      {/* 抑制名单校验 */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700">
          <ShieldAlert className="h-4 w-4 text-brand-500" /> {tr("抑制名单校验", "Suppression List Check")}
        </div>
        <div className="flex items-end gap-3">
          <div className="w-72">
            <TextField label={tr("标识符 / OneID", "Identifier / OneID")} value={supId} onChange={setSupId} placeholder={tr("手机号、邮箱或 one_id", "Phone, email or one_id")} />
          </div>
          <Button variant="outline" onClick={checkSup} disabled={supBusy || !supId}>
            {supBusy ? <Spinner /> : <Search className="h-4 w-4" />} {tr("校验", "Check")}
          </Button>
        </div>
        {supRes && (
          <div className="mt-4 text-sm">
            {supRes.suppressed ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge color="red">{tr("已抑制", "Suppressed")}</Badge>
                {supRes.suppression_type && <span className="text-gray-600">{tr("类型：", "Type: ")}{supRes.suppression_type}</span>}
                {supRes.reason && <span className="text-gray-600">{tr("原因：", "Reason: ")}{supRes.reason}</span>}
              </div>
            ) : (
              <div className="flex items-center gap-2"><Badge color="green">{tr("未抑制", "Not Suppressed")}</Badge>
                {supRes.reason && <span className="text-gray-500">{supRes.reason}</span>}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 新建工单 */}
      <Modal open={open} title={tr("新建删除/抑制工单", "New Deletion / Suppression Request")} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label={tr("数据主体标识符", "Data Subject Identifier")} value={identifier} onChange={setIdentifier} placeholder={tr("手机号 / 邮箱 / 渠道ID", "Phone / Email / Channel ID")} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{tr("工单类型", "Request Type")}</span>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={rtype}
              onChange={(e) => setRtype(e.target.value as "delete" | "suppress" | "both")}
            >
              <option value="delete">{tr("删除（清理身份与画像数据）", "Delete (purge identity & profile data)")}</option>
              <option value="suppress">{tr("抑制（加入抑制名单）", "Suppress (add to suppression list)")}</option>
              <option value="both">{tr("删除 + 抑制", "Delete + Suppress")}</option>
            </select>
          </label>
          <TextField label={tr("原因", "Reason")} value={reason} onChange={setReason} placeholder={tr("如 用户申请注销", "e.g. user requested account closure")} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button onClick={save} disabled={saving || !identifier.trim()}>
              {saving ? <Spinner /> : tr("创建工单", "Create Request")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 工单详情 */}
      <Modal open={!!detail} title={detail ? tr(`工单 #${detail.request_id} 详情`, `Request #${detail.request_id} Details`) : ""} onClose={() => setDetail(null)}>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Field k={tr("标识符", "Identifier")} v={detail.identifier || (detail.one_id != null ? `one_id:${detail.one_id}` : "—")} />
              <Field k={tr("类型", "Type")} v={typeLabel(tr, detail.request_type)} />
              <Field k={tr("状态", "Status")} v={statusLabel(tr, detail.status)} />
              <Field k={tr("影响记录", "Affected Records")} v={detail.affected_count ?? "—"} />
              <Field k={tr("提交时间", "Submitted At")} v={detail.created_at || "—"} />
              <Field k={tr("执行时间", "Executed At")} v={detail.executed_at || "—"} />
            </div>
            {detail.affected_tables && Object.keys(detail.affected_tables).length > 0 && (
              <div>
                <div className="mb-1 font-medium text-gray-700">{tr("影响表", "Affected Tables")}</div>
                <div className="rounded-lg bg-gray-50 p-2 font-mono text-xs text-gray-600">
                  {Object.entries(detail.affected_tables).map(([t, n]) => (
                    <div key={t}>{t}: {n}</div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1 font-medium text-gray-700">{tr("审计日志", "Audit Log")}</div>
              {detail.audit_log.length === 0 ? (
                <div className="text-gray-400">{tr("暂无", "None")}</div>
              ) : (
                <ul className="space-y-1">
                  {detail.audit_log.map((a) => (
                    <li key={a.audit_id} className="flex justify-between gap-2 text-xs text-gray-600">
                      <span>{a.operation_type}{tr(`（影响 ${a.affected_records}）`, ` (affected ${a.affected_records})`)}</span>
                      <span className="text-gray-400">{a.created_at}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </Layout>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-gray-400">{k}</div>
      <div className="text-gray-800">{v}</div>
    </div>
  );
}
