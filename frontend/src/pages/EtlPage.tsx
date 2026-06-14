import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Database, FileSpreadsheet, Radio, Cloud, ArrowRight, Filter, Wand2, Play, Eye, Plus, X } from "lucide-react";
import Layout from "../components/layout/Layout";
import { Card, Badge, Button, Spinner, DataTable } from "../components/ui";
import { OBJECTS, byKey } from "../lib/objects";
import { getMetadata, etlPreview, etlImport, type EtlFieldMap } from "../api/client";
import type { Metadata } from "../api/types";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";

const SOURCES = [
  { key: "csv", icon: FileSpreadsheet, name: "CSV / 粘贴", nameEn: "CSV / Paste", desc: "含表头的文本", descEn: "Text with header row", ready: true },
  { key: "mysql", icon: Database, name: "MySQL", nameEn: "MySQL", desc: "业务库 / 离线表", descEn: "Business DB / offline tables", ready: false },
  { key: "kafka", icon: Radio, name: "Kafka", nameEn: "Kafka", desc: "实时事件流", descEn: "Real-time event stream", ready: false },
  { key: "api", icon: Cloud, name: "REST API", nameEn: "REST API", desc: "三方数据源", descEn: "Third-party sources", ready: false },
];

const targets = OBJECTS.filter((o) => o.kind === "object");

const SAMPLE_CSV = `product_id,sku,category,price
P8001,无线耳机,数码,399
P8002,机械键盘,数码,599`;

function parseHeader(csv: string, delim = ","): string[] {
  const first = csv.trim().split(/\r?\n/)[0] || "";
  return first.split(delim).map((s) => s.trim()).filter(Boolean);
}

export default function EtlPage() {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [meta, setMeta] = useState<Metadata | null>(null);
  const [sourceType, setSourceType] = useState("csv");
  const [csv, setCsv] = useState(SAMPLE_CSV);
  const [target, setTarget] = useState("product");
  const [mapping, setMapping] = useState<EtlFieldMap[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof etlPreview>> | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof etlImport>> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getMetadata(tenant).then(setMeta).catch((e) => setErr(String(e))); }, [tenant]);

  const sourceCols = useMemo(() => parseHeader(csv), [csv]);
  const targetFields = useMemo(
    () => meta?.objects.find((o) => o.object === target)?.fields.map((f) => f.code) || [],
    [meta, target],
  );

  // 按同名（不区分大小写 / 互相包含）自动建议映射
  function autoMap(): EtlFieldMap[] {
    const match = (f: string) => sourceCols.find((c) => {
      const a = c.toLowerCase(), b = f.toLowerCase();
      return a === b || a.includes(b) || b.includes(a);
    });
    const auto = targetFields.map((f) => ({ target: f, source: match(f) })).filter((m) => m.source) as EtlFieldMap[];
    return auto.length ? auto : [{ target: targetFields[0], source: sourceCols[0] || "" }];
  }

  // 切换目标 / 首次：自动建议映射
  useEffect(() => {
    if (!targetFields.length) return;
    setMapping((prev) => (prev.length ? prev : autoMap()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFields.join(","), target]);

  function resetForTarget(t: string) {
    setTarget(t); setMapping([]); setPreview(null); setResult(null);
  }

  const body = () => ({
    tenant_id: tenant, target_object: target,
    source: { type: sourceType, csv }, mapping,
  });

  async function run(kind: "preview" | "import") {
    setBusy(kind); setErr(null);
    if (kind === "import") setResult(null);
    try {
      if (kind === "preview") setPreview(await etlPreview(body()));
      else setResult(await etlImport(body()));
    } catch (e: any) {
      setErr(e?.response?.data?.detail ? JSON.stringify(e.response.data.detail) : (e?.message || String(e)));
    } finally { setBusy(null); }
  }

  return (
    <Layout
      title={tr("添加数据源 Add Source", "Add Source")}
      subtitle={tr("多数据源 → 字段映射 → 导入多对象 → 进入统一筛选", "Multiple sources → field mapping → import to objects → unified filter")}
      actions={<Badge color="green">{tr("CSV/Inline 可运行", "CSV/Inline ready")}</Badge>}
    >

      <div className="grid gap-5 lg:grid-cols-3">
        {/* 1 数据源 */}
        <Card className="p-5">
          <StepTitle n={1} title={tr("数据源", "Sources")} />
          <div className="mb-3 grid grid-cols-2 gap-2">
            {SOURCES.map((s) => (
              <button
                key={s.key}
                disabled={!s.ready}
                onClick={() => s.ready && setSourceType(s.key)}
                className={`rounded-xl border p-3 text-left text-sm transition-colors ${
                  sourceType === s.key ? "border-brand-400 bg-brand-50" : "border-gray-200 bg-white"
                } ${s.ready ? "hover:border-brand-300" : "cursor-not-allowed opacity-50"}`}
              >
                <s.icon className="mb-1 h-4 w-4 text-gray-600" />
                <div className="font-medium text-gray-800">{tr(s.name, s.nameEn)}</div>
                <div className="text-xs text-gray-400">{s.ready ? tr(s.desc, s.descEn) : tr("路线图", "Roadmap")}</div>
              </button>
            ))}
          </div>
          <textarea
            className="h-44 w-full rounded-lg border border-gray-300 p-3 font-mono text-xs focus:border-brand-400 focus:outline-none"
            value={csv}
            onChange={(e) => { setCsv(e.target.value); }}
            placeholder={tr("粘贴 CSV（首行表头）", "Paste CSV (first row is header)")}
          />
          {sourceCols.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {sourceCols.map((c) => <Badge key={c}>{c}</Badge>)}
            </div>
          )}
        </Card>

        {/* 2 目标对象 */}
        <Card className="p-5">
          <StepTitle n={2} title={tr("导入目标（多对象）", "Import Target (Objects)")} />
          <div className="grid grid-cols-2 gap-2">
            {targets.map((o) => (
              <button
                key={o.key}
                onClick={() => resetForTarget(o.key)}
                className={`flex items-center gap-2 rounded-xl border p-3 text-sm transition-colors ${
                  target === o.key ? "border-brand-400 bg-brand-50" : "border-gray-200 bg-white hover:border-brand-300"
                }`}
              >
                <o.icon className="h-4 w-4 text-gray-600" />
                <span className="font-medium text-gray-800">{o.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 text-xs text-gray-400">
            {tr("目标字段：", "Target fields: ")}{targetFields.join(" / ") || "…"}
          </div>
        </Card>

        {/* 3 字段映射 */}
        <Card className="p-5">
          <StepTitle n={3} title={tr("字段映射", "Field Mapping")} />
          <div className="space-y-2">
            {mapping.map((m, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <select
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                  value={m.source || ""}
                  onChange={(e) => setMapping(mapping.map((x, j) => j === i ? { ...x, source: e.target.value } : x))}
                >
                  <option value="">{tr("（源列）", "(Source column)")}</option>
                  {sourceCols.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                <select
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                  value={m.target}
                  onChange={(e) => setMapping(mapping.map((x, j) => j === i ? { ...x, target: e.target.value } : x))}
                >
                  {targetFields.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <button onClick={() => setMapping(mapping.filter((_, j) => j !== i))}
                  className="rounded p-1 text-gray-400 hover:text-red-500">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMapping([...mapping, { target: targetFields[0] || "", source: sourceCols[0] || "" }])}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                <Plus className="h-3.5 w-3.5" /> {tr("添加映射", "Add mapping")}
              </button>
              <button
                onClick={() => setMapping(autoMap())}
                className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                <Wand2 className="h-3.5 w-3.5" /> {tr("自动匹配", "Auto match")}
              </button>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => run("preview")} disabled={!!busy}>
              {busy === "preview" ? <Spinner /> : <Eye className="h-4 w-4" />} {tr("预览", "Preview")}
            </Button>
            <Button onClick={() => run("import")} disabled={!!busy}>
              {busy === "import" ? <Spinner /> : <Play className="h-4 w-4" />} {tr("导入", "Import")}
            </Button>
          </div>
        </Card>
      </div>

      {err && <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{err}</div>}

      {/* 预览 */}
      {preview && (
        <Card className="mt-5 p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Wand2 className="h-4 w-4 text-brand-500" /> {tr("预览（共 ", "Preview (")}{preview.total_rows}{tr(" 行，映射到 ", " rows, mapped to ")}{byKey(preview.target_object)?.label}{tr("）", ")")}
          </div>
          {preview.issues.length > 0 && (
            <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {preview.issues.map((s, i) => <div key={i}>• {s}</div>)}
            </div>
          )}
          <DataTable
            columns={preview.preview[0] ? Object.keys(preview.preview[0]) : [tr("（空映射）", "(Empty mapping)")]}
            rows={preview.preview}
          />
        </Card>
      )}

      {/* 导入结果 */}
      {result && (
        <Card className="mt-5 flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-6">
            <Stat label={tr("导入成功", "Imported")} value={result.imported} color="text-green-600" />
            <Stat label={tr("建立关系", "Relations created")} value={result.relations} color="text-brand-600" />
            <Stat label={tr("失败", "Failed")} value={result.failed} color={result.failed ? "text-red-600" : "text-gray-400"} />
          </div>
          <Link to={`/objects/${result.target_object}`}>
            <Button><Filter className="h-4 w-4" /> {tr("去筛选 ", "Filter ")}{byKey(result.target_object)?.label}</Button>
          </Link>
        </Card>
      )}
      {result && result.errors.length > 0 && (
        <Card className="mt-3 p-4 text-sm text-red-600">
          {result.errors.map((e, i) => <div key={i}>{tr("第 ", "Row ")}{e.row}{tr(" 行：", ": ")}{e.error}</div>)}
        </Card>
      )}
    </Layout>
  );
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-600">{n}</span>
      <span className="text-sm font-semibold text-gray-800">{title}</span>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
