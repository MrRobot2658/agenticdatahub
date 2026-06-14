import { useCallback, useEffect, useState } from "react";
import { ScanSearch, ShieldCheck } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Button, Spinner, Badge } from "../components/ui";
import { StatCards, EmptyState } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import {
  listPiiRules,
  scanPii,
  createPiiRule,
  deletePiiRule,
  updatePiiRule,
  type PiiRule,
  type PiiDetectedField,
  type PiiAction,
} from "../api/privacy";

const ACTION_COLOR: Record<string, string> = {
  hash: "brand", block: "red", allow: "gray", mask: "amber", drop: "red", encrypt: "brand",
};

export default function PrivacyDataControlsPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [rules, setRules] = useState<PiiRule[] | null>(null);
  const [detected, setDetected] = useState<PiiDetectedField[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const ACTION_LABEL: Record<string, string> = {
    hash: tr("哈希", "Hash"),
    block: tr("阻断", "Block"),
    allow: tr("明文放行", "Allow plaintext"),
    mask: tr("掩码", "Mask"),
    drop: tr("丢弃", "Drop"),
    encrypt: tr("加密", "Encrypt"),
  };

  const COL = {
    object: tr("对象", "Object"),
    field: tr("字段", "Field"),
    category: tr("类别", "Category"),
    confidence: tr("置信度", "Confidence"),
    suggestedAction: tr("建议动作", "Suggested action"),
    status: tr("状态", "Status"),
    actions: tr("操作", "Actions"),
    action: tr("动作", "Action"),
    scope: tr("范围", "Scope"),
    targetObjects: tr("适用对象", "Applied objects"),
  };

  const load = useCallback(() => {
    setRules(null); setErr(null);
    listPiiRules(tenant).then(setRules).catch((e) => setErr(String(e)));
  }, [tenant]);

  useEffect(() => { load(); setDetected(null); }, [load]);

  const runScan = async () => {
    setScanning(true); setErr(null);
    try {
      const r = await scanPii({ tenant_id: tenant, scan_depth: "all" });
      setDetected(r.detected_fields);
    } catch (e) { setErr(String(e)); }
    finally { setScanning(false); }
  };

  const govern = async (f: PiiDetectedField) => {
    setBusy(`scan:${f.field}`);
    try {
      await createPiiRule({
        tenant_id: tenant,
        field_name: f.field,
        category: f.category,
        action: f.suggested_action as PiiAction,
        scope: "全局",
        target_objects: f.object ? [f.object] : undefined,
        created_by: "console",
      });
      await runScan();
      load();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  };

  const toggle = async (r: PiiRule) => {
    setBusy(`rule:${r.rule_id}`);
    try {
      if (r.is_active) await deletePiiRule(tenant, r.rule_id);
      else await updatePiiRule(tenant, r.rule_id, { is_active: 1 });
      load();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(null); }
  };

  const active = (rules || []).filter((r) => r.is_active);

  return (
    <Layout
      title={tr("数据管控 Data Controls", "Data Controls")}
      subtitle={tr("检测与管控 PII / 敏感字段，按字段配置哈希、阻断或明文动作（来自 /privacy/pii）", "Detect and govern PII / sensitive fields; configure hash, block, or plaintext actions per field (from /privacy/pii)")}
      actions={
        <Button onClick={runScan} disabled={scanning}>
          {scanning ? <Spinner /> : <ScanSearch className="h-4 w-4" />} {tr("扫描 PII", "Scan PII")}
        </Button>
      }
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      <StatCards items={[
        { label: tr("受管字段", "Governed fields"), value: rules ? active.length : "…" },
        { label: tr("阻断动作", "Block actions"), value: rules ? active.filter((r) => r.action === "block").length : "…" },
        { label: tr("明文放行", "Allow plaintext"), value: rules ? active.filter((r) => r.action === "allow").length : "…" },
        { label: tr("已禁用规则", "Disabled rules"), value: rules ? (rules.length - active.length) : "…" },
      ]} />

      {/* 扫描结果 */}
      {detected && (
        <Card className="mb-6 p-2">
          <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700">
            <ScanSearch className="h-4 w-4 text-brand-500" /> {tr(`扫描结果 · 命中 ${detected.length} 个疑似字段`, `Scan results · ${detected.length} suspected fields`)}
          </div>
          <DataTable
            columns={[COL.object, COL.field, COL.category, COL.confidence, COL.suggestedAction, COL.status, COL.actions]}
            rows={detected.map((f) => ({
              [COL.object]: f.object,
              [COL.field]: f.field,
              [COL.category]: f.category,
              [COL.confidence]: `${Math.round(f.confidence * 100)}%`,
              [COL.suggestedAction]: <Badge color={ACTION_COLOR[f.suggested_action] || "gray"}>{ACTION_LABEL[f.suggested_action] || f.suggested_action}</Badge>,
              [COL.status]: f.already_governed
                ? <Badge color="green">{tr("已管控", "Governed")}</Badge>
                : <Badge color="amber">{tr("未管控", "Ungoverned")}</Badge>,
              [COL.actions]: f.already_governed ? (
                <span className="text-xs text-gray-400">—</span>
              ) : (
                <Button variant="outline" onClick={() => govern(f)} disabled={busy === `scan:${f.field}`}>
                  {busy === `scan:${f.field}` ? <Spinner /> : <ShieldCheck className="h-3.5 w-3.5" />} {tr("管控", "Govern")}
                </Button>
              ),
            }))}
          />
        </Card>
      )}

      {/* 管控规则 */}
      {!rules && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中…", "Loading…")}</div>}
      {rules && rules.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          title={tr("暂无 PII 管控规则", "No PII governance rules")}
          desc={tr("点击右上角「扫描 PII」自动发现敏感字段，并一键加入管控。", "Click “Scan PII” in the top right to auto-discover sensitive fields and govern them in one click.")}
        />
      )}
      {rules && rules.length > 0 && (
        <Card className="p-2">
          <div className="px-3 py-2 text-sm font-medium text-gray-700">{tr("管控规则", "Governance rules")}</div>
          <DataTable
            columns={[COL.field, COL.category, COL.action, COL.scope, COL.targetObjects, COL.status, COL.actions]}
            rows={rules.map((r) => ({
              [COL.field]: r.field_name,
              [COL.category]: r.category || "—",
              [COL.action]: <Badge color={ACTION_COLOR[r.action] || "gray"}>{ACTION_LABEL[r.action] || r.action}</Badge>,
              [COL.scope]: r.scope || tr("全局", "Global"),
              [COL.targetObjects]: (r.target_objects && r.target_objects.length) ? r.target_objects.join(", ") : tr("全部", "All"),
              [COL.status]: r.is_active ? <Badge color="green">{tr("启用", "Enabled")}</Badge> : <Badge color="gray">{tr("禁用", "Disabled")}</Badge>,
              [COL.actions]: (
                <Button variant="outline" onClick={() => toggle(r)} disabled={busy === `rule:${r.rule_id}`}>
                  {busy === `rule:${r.rule_id}` ? <Spinner /> : (r.is_active ? tr("禁用", "Disable") : tr("启用", "Enable"))}
                </Button>
              ),
            }))}
          />
        </Card>
      )}
    </Layout>
  );
}
