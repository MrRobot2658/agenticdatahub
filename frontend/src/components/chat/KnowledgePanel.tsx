import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText, Image as ImageIcon, Video, Music, FileArchive, File as FileIcon,
  FolderOpen, Folder, Star, Cpu, ChevronDown, RefreshCw, Upload, type LucideIcon,
} from "lucide-react";
import { useLang } from "../../context/LangContext";
import { useTenant } from "../../context/TenantContext";
import { listKbFiles, setKbContext, uploadKbFile, type KbFile, type KbKind } from "../../api/kb";

/**
 * 知识库面板 —— 按「卡帕西 LLM 知识库管理模式」构建（接真实 kb_api）：
 *   LLM OS 隐喻：上下文窗口 = RAM、文件 = 磁盘。
 *   分域文件夹（按 kb_files.folder）承载多模态资料（文档/图片/视频/音频/文件），
 *   每个文件可「策展」纳入 LLM 上下文（持久化到 kb_files.in_context），
 *   顶部实时估算已纳入的 token 占用（工作记忆预算）。
 */

const KIND_ICON: Record<KbKind, LucideIcon> = {
  document: FileText, image: ImageIcon, video: Video, audio: Music, archive: FileArchive, other: FileIcon,
};
const KIND_CLS: Record<KbKind, string> = {
  document: "text-sky-600", image: "text-emerald-600", video: "text-rose-600",
  audio: "text-violet-600", archive: "text-amber-600", other: "text-gray-500",
};

const CONTEXT_WINDOW = 200_000; // 模拟上下文窗口（tokens）

function fmtTok(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}
function fmtSize(b: number) {
  if (b >= 1 << 30) return `${(b / (1 << 30)).toFixed(1)} GB`;
  if (b >= 1 << 20) return `${(b / (1 << 20)).toFixed(1)} MB`;
  if (b >= 1 << 10) return `${(b / (1 << 10)).toFixed(0)} KB`;
  return `${b} B`;
}
const folderName = (f: string) => (f || "/").replace(/^\//, "") || "根目录";

export default function KnowledgePanel() {
  const { tr } = useLang();
  const { tenant } = useTenant();
  const [files, setFiles] = useState<KbFile[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    if (e.target) e.target.value = "";
    if (!picked.length) return;
    const folder = (window.prompt(tr("放入哪个文件夹？（如 /产品知识）", "Folder? (e.g. /Product)"), "/上传") || "/上传").trim() || "/上传";
    setUploading(true);
    try {
      for (const f of picked) await uploadKbFile(tenant, f, folder);
      await load();
      setOpenFolders((s) => new Set(s).add(folder));
    } catch { /* ignore */ }
    finally { setUploading(false); }
  }

  async function load() {
    setLoading(true);
    try {
      const fs = await listKbFiles(tenant);
      setFiles(fs);
      // 默认展开第一个有「已纳入」内容的域，否则第一个域
      setOpenFolders((prev) => {
        if (prev.size) return prev;
        const withCtx = fs.find((f) => f.in_context)?.folder;
        const first = withCtx || fs[0]?.folder;
        return first ? new Set([first]) : new Set();
      });
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { setOpenFolders(new Set()); load(); /* eslint-disable-line */ }, [tenant]);

  // 按 folder 分组（保持后端返回顺序内的稳定分组）
  const folders = useMemo(() => {
    const map = new Map<string, KbFile[]>();
    (files || []).forEach((f) => {
      const k = f.folder || "/";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(f);
    });
    return Array.from(map.entries());
  }, [files]);

  const inCtx = useMemo(() => (files || []).filter((f) => f.in_context), [files]);
  const usedTokens = inCtx.reduce((s, f) => s + (f.token_estimate || 0), 0);
  const pct = Math.min(100, Math.round((usedTokens / CONTEXT_WINDOW) * 100));

  const toggleFolderOpen = (k: string) =>
    setOpenFolders((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // 乐观更新 + 持久化；失败回滚
  async function persist(ids: string[], next: boolean) {
    setFiles((fs) => (fs || []).map((f) => (ids.includes(f.id) ? { ...f, in_context: next } : f)));
    setBusy((b) => { const n = new Set(b); ids.forEach((i) => n.add(i)); return n; });
    const results = await Promise.allSettled(ids.map((id) => setKbContext(tenant, id, next)));
    const failed = ids.filter((_, i) => results[i].status === "rejected");
    if (failed.length) {
      setFiles((fs) => (fs || []).map((f) => (failed.includes(f.id) ? { ...f, in_context: !next } : f)));
    }
    setBusy((b) => { const n = new Set(b); ids.forEach((i) => n.delete(i)); return n; });
  }
  const toggleItem = (f: KbFile) => persist([f.id], !f.in_context);
  const toggleFolder = (items: KbFile[]) => {
    const allIn = items.every((i) => i.in_context);
    persist(items.map((i) => i.id), !allIn);
  };

  const totalFiles = files?.length ?? 0;

  return (
    <div className="mt-3 border-t border-gray-200 pt-2">
      {/* 分区标题 + LLM OS 隐喻 */}
      <div className="flex items-center gap-2 px-1 pb-1">
        <Cpu className="h-4 w-4 text-brand-600" />
        <div className="flex-1">
          <div className="text-[12.5px] font-semibold text-gray-900">{tr("知识库", "Knowledge")}</div>
          <div className="text-[10px] text-gray-400">{tr("上下文 = RAM · 文件 = 磁盘", "context = RAM · files = disk")}</div>
        </div>
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
          {folders.length} {tr("域", "domains")} · {totalFiles} {tr("文件", "files")}
        </span>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={onUpload} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-brand-600 disabled:opacity-40" title={tr("上传文件", "Upload")}>
          <Upload className={`h-3.5 w-3.5 ${uploading ? "animate-pulse" : ""}`} />
        </button>
        <button type="button" onClick={load} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" title={tr("刷新", "Refresh")}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* 上下文预算条（已策展进 LLM 的工作记忆） */}
      <div className="mx-1 mb-2 rounded-lg border border-brand-100 bg-brand-50/60 px-2.5 py-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-medium text-brand-700">{tr("已纳入上下文", "In context")} · {inCtx.length}</span>
          <span className="font-mono tabular-nums text-brand-700">{fmtTok(usedTokens)} / {fmtTok(CONTEXT_WINDOW)}</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-brand-100">
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* 状态：加载 / 空 */}
      {files === null && (
        <div className="px-1 py-3 text-center text-[11px] text-gray-400">{tr("加载中…", "Loading…")}</div>
      )}
      {files !== null && folders.length === 0 && (
        <div className="px-1 py-4 text-center text-[11px] text-gray-400">{tr("暂无文件，去「上传」添加资料", "No files yet")}</div>
      )}

      {/* 分域文件夹（多模态） */}
      <div className="space-y-1">
        {folders.map(([folder, items]) => {
          const expanded = openFolders.has(folder);
          const inN = items.filter((i) => i.in_context).length;
          const allIn = inN === items.length;
          return (
            <div key={folder} className={`overflow-hidden rounded-lg border ${expanded ? "border-gray-200" : "border-gray-100"}`}>
              <div className={`flex items-center gap-1.5 px-2 py-1.5 ${expanded ? "bg-gray-50" : "bg-gray-50/60 hover:bg-gray-50"}`}>
                <button type="button" onClick={() => toggleFolderOpen(folder)} className="flex flex-1 items-center gap-1.5 text-left">
                  {expanded ? <FolderOpen className="h-4 w-4 text-amber-500" /> : <Folder className="h-4 w-4 text-amber-500" />}
                  <span className="flex-1 truncate text-[12px] text-gray-700">{folderName(folder)}</span>
                  {inN > 0 && (
                    <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[9px] font-medium text-brand-600">{inN} {tr("入", "in")}</span>
                  )}
                  <span className="text-[10px] tabular-nums text-gray-400">{items.length}</span>
                  <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
                <button type="button" onClick={() => toggleFolder(items)}
                  title={allIn ? tr("整域移出上下文", "Remove folder from context") : tr("整域纳入上下文", "Add folder to context")}
                  className="rounded p-0.5 hover:bg-gray-200/70">
                  <Star className={`h-3.5 w-3.5 ${allIn ? "fill-brand-500 text-brand-500" : inN > 0 ? "fill-brand-200 text-brand-400" : "text-gray-300"}`} />
                </button>
              </div>
              {expanded && (
                <div className="border-t border-gray-100 bg-white px-1.5 py-1">
                  {items.map((it) => {
                    const Icon = KIND_ICON[it.kind] || FileIcon;
                    const on = it.in_context;
                    const isBusy = busy.has(it.id);
                    return (
                      <div key={it.id} className="group flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-gray-50">
                        <Icon className={`h-3.5 w-3.5 shrink-0 ${KIND_CLS[it.kind] || "text-gray-500"}`} />
                        <span className="flex-1 truncate text-[11.5px] text-gray-600" title={it.name}>{it.name}</span>
                        <span className="shrink-0 text-[9.5px] tabular-nums text-gray-300">{fmtSize(it.size_bytes)}</span>
                        <span className="w-9 shrink-0 text-right font-mono text-[9.5px] tabular-nums text-gray-400">{fmtTok(it.token_estimate)}</span>
                        <button type="button" disabled={isBusy} onClick={() => toggleItem(it)}
                          title={on ? tr("移出上下文", "Remove from context") : tr("纳入上下文", "Add to context")}
                          className="rounded p-0.5 hover:bg-gray-200/70 disabled:opacity-40">
                          <Star className={`h-3.5 w-3.5 ${on ? "fill-brand-500 text-brand-500" : "text-gray-300 group-hover:text-gray-400"}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
