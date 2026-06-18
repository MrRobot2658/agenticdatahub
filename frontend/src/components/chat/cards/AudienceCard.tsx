import { useEffect, useState } from "react";
import { Users, Save, Check } from "lucide-react";
import { draftSegment, confirmSegment } from "../../../api/client";
import { useTenant } from "../../../context/TenantContext";
import type { DraftResult } from "../../../api/types";
import { byKey } from "../../../lib/objects";
import { OP_LABELS } from "../../../lib/objects";
import CardShell from "./CardShell";

// 人群预估内联卡片：NL→DSL（draftSegment）→ 估算规模 + 条件回显 + 「保存为人群」。
export default function AudienceCard({ query }: { query: string }) {
  const { tenant } = useTenant();
  const [draft, setDraft] = useState<DraftResult | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    setDraft(undefined); setErr(null); setSaved(null);
    draftSegment(tenant, query)
      .then((d) => setDraft(d))
      .catch((e) => setErr(e?.response?.data?.detail || String(e)));
  }, [query, tenant]);

  async function save() {
    if (!draft?.rule) return;
    const name = window.prompt("人群包名称：", query.slice(0, 20) || "新人群");
    if (!name) return;
    setSaving(true);
    try {
      const code = `seg_${name}_${Math.random().toString(36).slice(2, 7)}`;
      await confirmSegment(tenant, code, name, draft.rule);
      setSaved(name);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || String(e));
    } finally {
      setSaving(false);
    }
  }

  const loading = draft === undefined && !err;
  const objLabel = draft?.rule ? (byKey(draft.rule.object)?.label ?? draft.rule.object) : "";

  return (
    <CardShell
      icon={<Users className="h-4 w-4" />}
      title="人群预估"
      subtitle={query}
      loading={loading}
      error={err}
      actions={
        draft?.rule && !saved ? (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-2 py-1 text-[11px] font-medium text-white hover:bg-brand-600 disabled:bg-brand-300"
          >
            <Save className="h-3 w-3" /> {saving ? "保存中…" : "保存为人群"}
          </button>
        ) : saved ? (
          <span className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2 py-1 text-[11px] font-medium text-green-600">
            <Check className="h-3 w-3" /> 已保存
          </span>
        ) : null
      }
    >
      {draft && (
        <div className="space-y-2.5">
          {draft.needs_clarification && draft.clarifications?.length ? (
            <div className="rounded-lg bg-amber-50 px-2.5 py-2 text-[12px] text-amber-700">
              需要澄清：{draft.clarifications.join("；")}
            </div>
          ) : null}
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-brand-600">{draft.estimate != null ? Number(draft.estimate).toLocaleString() : "—"}</span>
            <span className="text-[12px] text-gray-400">预估命中{objLabel ? ` · ${objLabel}` : ""}</span>
          </div>
          {draft.summary && <div className="text-[13px] text-gray-700">{draft.summary}</div>}
          {draft.rule?.conditions?.length ? (
            <div>
              <div className="mb-1 text-[11px] font-medium text-gray-400">筛选条件</div>
              <div className="flex flex-wrap gap-1">
                {draft.rule.conditions.map((c, i) => (
                  <span key={i} className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                    {c.field} {OP_LABELS[c.op] ?? c.op} {Array.isArray(c.value) ? c.value.join("/") : String(c.value)}
                  </span>
                ))}
                {draft.rule.relations?.length ? (
                  <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">+{draft.rule.relations.length} 跨对象关系</span>
                ) : null}
              </div>
            </div>
          ) : null}
          {saved && <div className="text-[12px] text-green-600">已保存为人群「{saved}」，可在受众里查看。</div>}
        </div>
      )}
    </CardShell>
  );
}
