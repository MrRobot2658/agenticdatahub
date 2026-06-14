import { useCallback, useEffect, useState } from "react";
import { Plus, Search, BadgeCheck } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, DataTable, Button, Spinner, Badge, Modal, TextField } from "../components/ui";
import { StatCards } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import {
  listConsentCategories,
  createConsentCategory,
  getConsent,
  type ConsentCategory,
  type ConsentRecord,
} from "../api/privacy";

export default function PrivacyConsentPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [cats, setCats] = useState<ConsentCategory[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 新建分类
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [required, setRequired] = useState(false);
  const [vendors, setVendors] = useState("");
  const [saving, setSaving] = useState(false);

  // 用户同意查询
  const [oneId, setOneId] = useState("");
  const [records, setRecords] = useState<ConsentRecord[] | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  const load = useCallback(() => {
    setCats(null); setErr(null);
    listConsentCategories(tenant).then(setCats).catch((e) => setErr(String(e)));
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createConsentCategory({
        tenant_id: tenant,
        category_name: name.trim(),
        description: desc.trim() || undefined,
        is_required: required,
        vendor_list: vendors.split(",").map((v) => v.trim()).filter(Boolean),
        created_by: "console",
      });
      setOpen(false); setName(""); setDesc(""); setRequired(false); setVendors("");
      load();
    } catch (e) { setErr(String(e)); }
    finally { setSaving(false); }
  };

  const lookup = async () => {
    const id = Number(oneId);
    if (!id) return;
    setLooking(true); setLookupErr(null); setRecords(null);
    try {
      const r = await getConsent(tenant, id);
      setRecords(r.records);
    } catch (e) { setLookupErr(String(e)); }
    finally { setLooking(false); }
  };

  const CAT_COL = {
    category: tr("分类", "Category"),
    desc: tr("说明", "Description"),
    required: tr("是否必选", "Required"),
    rate: tr("同意率", "Opt-in Rate"),
    vendors: tr("厂商", "Vendors"),
  };
  const REC_COL = {
    category: tr("分类", "Category"),
    status: tr("授权状态", "Consent Status"),
    grantedAt: tr("授权时间", "Granted At"),
    withdrawnAt: tr("撤回时间", "Withdrawn At"),
  };

  return (
    <Layout
      title={tr("同意管理 Consent", "Consent Management")}
      subtitle={tr("管理同意分类与厂商映射，按主体（one_id）查询授权状态（来自 /privacy/consent）", "Manage consent categories and vendor mappings, and look up authorization status by subject (one_id) — from /privacy/consent")}
      actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> {tr("新建分类", "New Category")}</Button>}
    >
      {err && <Card className="mb-4 p-4 text-sm text-red-600">{err}</Card>}

      <StatCards items={[
        { label: tr("同意分类数", "Consent Categories"), value: cats ? cats.length : "…" },
        { label: tr("必选类", "Required"), value: cats ? cats.filter((c) => c.is_required).length : "…" },
        { label: tr("厂商总数", "Total Vendors"), value: cats ? cats.reduce((a, c) => a + (c.vendors?.length || 0), 0) : "…" },
        { label: tr("可选类", "Optional"), value: cats ? cats.filter((c) => !c.is_required).length : "…" },
      ]} />

      {!cats && !err && <div className="flex items-center gap-2 text-gray-500"><Spinner /> {tr("加载中", "Loading")}…</div>}
      {cats && (
        <Card className="mb-6 p-2">
          <div className="px-3 py-2 text-sm font-medium text-gray-700">{tr("同意分类", "Consent Categories")}</div>
          <DataTable
            columns={[CAT_COL.category, CAT_COL.desc, CAT_COL.required, CAT_COL.rate, CAT_COL.vendors]}
            rows={cats.map((c) => ({
              [CAT_COL.category]: c.category_name,
              [CAT_COL.desc]: c.description || "—",
              [CAT_COL.required]: c.is_required ? <Badge color="brand">{tr("必选", "Required")}</Badge> : <Badge>{tr("可选", "Optional")}</Badge>,
              [CAT_COL.rate]: `${c.optedIn_pct}%`,
              [CAT_COL.vendors]: (c.vendors && c.vendors.length) ? c.vendors.join(", ") : "—",
            }))}
          />
        </Card>
      )}

      {/* 主体同意查询 */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700">
          <BadgeCheck className="h-4 w-4 text-brand-500" /> {tr("主体同意查询", "Subject Consent Lookup")}
        </div>
        <div className="flex items-end gap-3">
          <div className="w-56">
            <TextField label="OneID" value={oneId} onChange={setOneId} placeholder={tr("输入 one_id", "Enter one_id")} />
          </div>
          <Button variant="outline" onClick={lookup} disabled={looking || !oneId}>
            {looking ? <Spinner /> : <Search className="h-4 w-4" />} {tr("查询", "Search")}
          </Button>
        </div>
        {lookupErr && <div className="mt-3 text-sm text-red-600">{lookupErr}</div>}
        {records && (
          <div className="mt-4">
            {records.length === 0 ? (
              <div className="text-sm text-gray-400">{tr("该主体暂无同意记录", "No consent records for this subject")}</div>
            ) : (
              <DataTable
                columns={[REC_COL.category, REC_COL.status, REC_COL.grantedAt, REC_COL.withdrawnAt]}
                rows={records.map((r) => ({
                  [REC_COL.category]: r.category_name || `#${r.category_id}`,
                  [REC_COL.status]: r.granted ? <Badge color="green">{tr("已授权", "Granted")}</Badge> : <Badge color="red">{tr("未授权", "Not Granted")}</Badge>,
                  [REC_COL.grantedAt]: r.granted_at || "—",
                  [REC_COL.withdrawnAt]: r.withdrawn_at || "—",
                }))}
              />
            )}
          </div>
        )}
      </Card>

      <Modal open={open} title={tr("新建同意分类", "New Consent Category")} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          <TextField label={tr("分类名称", "Category Name")} value={name} onChange={setName} placeholder={tr("如 营销邮件 / 个性化推荐", "e.g. Marketing Email / Personalized Recommendations")} />
          <TextField label={tr("说明", "Description")} value={desc} onChange={setDesc} placeholder={tr("可选", "Optional")} />
          <TextField label={tr("厂商（逗号分隔）", "Vendors (comma-separated)")} value={vendors} onChange={setVendors} placeholder={tr("如 微信, 巨量引擎", "e.g. WeChat, Ocean Engine")} />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            {tr("必选分类（用户不可拒绝）", "Required category (users cannot opt out)")}
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button onClick={save} disabled={saving || !name.trim()}>
              {saving ? <Spinner /> : tr("保存", "Save")}
            </Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
