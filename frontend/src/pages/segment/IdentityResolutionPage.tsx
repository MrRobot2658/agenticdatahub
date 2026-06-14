import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2 } from "lucide-react";
import Layout from "../../components/layout/Layout";
import { Card, Button, DataTable, Modal, TextField, Spinner } from "../../components/ui";
import { StatCards } from "../../components/segment/kit";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";
import {
  listIdentityRules, upsertIdentityRule, deleteIdentityRule,
  type IdentityRule, type IdentityRuleInput,
} from "../../api/unify";

const EMPTY: IdentityRuleInput = {
  identifier_type: "", priority: 50, max_per_profile: null,
  is_unique: false, is_primary: false, merge_strategy: "latest",
  description: "", enabled: true,
};

export default function IdentityResolutionPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [rows, setRows] = useState<IdentityRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<IdentityRuleInput>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setRows(await listIdentityRules(tenant));
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || tr("加载失败", "Failed to load"));
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!form.identifier_type.trim()) { setError(tr("请填写标识符类型", "Please enter an identifier type")); return; }
    setSaving(true); setError(null);
    try {
      await upsertIdentityRule(tenant, form);
      setOpen(false); setForm(EMPTY);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || tr("保存失败", "Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(ruleId: string) {
    if (!confirm(tr(`删除规则 ${ruleId}？`, `Delete rule ${ruleId}?`))) return;
    try {
      await deleteIdentityRule(tenant, ruleId);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e.message || tr("删除失败", "Failed to delete"));
    }
  }

  const uniqueCount = rows.filter((r) => !!r.is_unique).length;
  const primaryCount = rows.filter((r) => !!r.is_primary).length;

  const COL = {
    id: tr("标识符", "Identifier"),
    priority: tr("优先级", "Priority"),
    limit: tr("上限", "Limit"),
    unique: tr("唯一性", "Uniqueness"),
    primary: tr("主标识", "Primary"),
    merge: tr("merge 策略", "Merge strategy"),
    enabled: tr("启用", "Enabled"),
    desc: tr("说明", "Description"),
    actions: "",
  };

  return (
    <Layout
      title={tr("身份识别 Identity Resolution", "Identity Resolution")}
      subtitle={tr("将各渠道标识符实时识别并 merge 到统一 one_id", "Resolve identifiers from every channel in real time and merge them into a unified one_id")}
      actions={<Button onClick={() => { setForm(EMPTY); setError(null); setOpen(true); }}>
        <Plus className="h-4 w-4" /> {tr("新建规则", "New rule")}
      </Button>}
    >
      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}
      <StatCards items={[
        { label: "标识符数", value: rows.length },
        { label: "唯一标识数", value: uniqueCount },
        { label: "主标识数", value: primaryCount },
        { label: "merge 策略", value: "实时" },
      ]} />
      <Card className="p-2">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <DataTable
            columns={["标识符", "优先级", "上限", "唯一性", "主标识", "merge 策略", "启用", "说明", ""]}
            rows={rows.map((r) => ({
              "标识符": r.identifier_type,
              "优先级": r.priority,
              "上限": r.max_per_profile ?? "—",
              "唯一性": r.is_unique ? "唯一" : "非唯一",
              "主标识": r.is_primary ? "是" : "否",
              "merge 策略": r.merge_strategy ?? "—",
              "启用": r.enabled ? "启用" : "停用",
              "说明": r.description ?? "—",
              "": (
                <button onClick={(e) => { e.stopPropagation(); remove(r.rule_id); }}
                  className="text-gray-400 hover:text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              ),
            }))}
          />
        )}
      </Card>

      <Modal open={open} title="新建 / 编辑身份规则" onClose={() => setOpen(false)}>
        <div className="space-y-3">
          <TextField label="标识符类型" value={form.identifier_type}
            placeholder="wechat_openid / phone / email / device"
            onChange={(v) => setForm({ ...form, identifier_type: v })} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label="优先级" value={String(form.priority ?? 50)}
              onChange={(v) => setForm({ ...form, priority: Number(v) || 0 })} />
            <TextField label="每档案上限（留空=不限）" value={form.max_per_profile == null ? "" : String(form.max_per_profile)}
              onChange={(v) => setForm({ ...form, max_per_profile: v === "" ? null : Number(v) })} />
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">merge 策略</span>
            <select className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={form.merge_strategy ?? ""}
              onChange={(e) => setForm({ ...form, merge_strategy: e.target.value || null })}>
              <option value="latest">latest（最新优先）</option>
              <option value="take_min">take_min</option>
              <option value="take_max">take_max</option>
            </select>
          </label>
          <TextField label="说明" value={form.description ?? ""}
            onChange={(v) => setForm({ ...form, description: v })} />
          <div className="flex gap-4 text-sm text-gray-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!form.is_unique}
                onChange={(e) => setForm({ ...form, is_unique: e.target.checked })} /> 唯一
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!form.is_primary}
                onChange={(e) => setForm({ ...form, is_primary: e.target.checked })} /> 主标识
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.enabled !== false}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> 启用
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
