import { useEffect, useState } from "react";
import {
  X, Download, Star, FileText, Image as ImageIcon, Video, Music, FileArchive, File as FileIcon,
  Link2, type LucideIcon,
} from "lucide-react";
import { getKbFile, setKbContext, kbDownloadUrl, type KbFileDetail, type KbKind } from "../../api/kb";
import { useTenant } from "../../context/TenantContext";
import { useLang } from "../../context/LangContext";

const KIND_ICON: Record<KbKind, LucideIcon> = {
  document: FileText, image: ImageIcon, video: Video, audio: Music, archive: FileArchive, other: FileIcon,
};

function fmtSize(b?: number) {
  if (!b) return "—";
  if (b >= 1 << 30) return `${(b / (1 << 30)).toFixed(1)} GB`;
  if (b >= 1 << 20) return `${(b / (1 << 20)).toFixed(1)} MB`;
  if (b >= 1 << 10) return `${(b / (1 << 10)).toFixed(0)} KB`;
  return `${b} B`;
}

export default function KbFileModal({ open, fid, onClose, onChanged }: {
  open: boolean; fid: string | null; onClose: () => void; onChanged?: () => void;
}) {
  const { tenant } = useTenant();
  const { tr } = useLang();
  const [f, setF] = useState<KbFileDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !fid) { setF(null); return; }
    setLoading(true);
    getKbFile(tenant, fid).then(setF).catch(() => setF(null)).finally(() => setLoading(false));
  }, [open, fid, tenant]);

  if (!open) return null;
  const Icon = f ? (KIND_ICON[f.kind] || FileIcon) : FileIcon;
  const dl = fid ? kbDownloadUrl(tenant, fid) : "#";

  async function toggleCtx() {
    if (!f) return;
    const next = !f.in_context;
    setF({ ...f, in_context: next });
    try { await setKbContext(tenant, f.id, next); onChanged?.(); } catch { setF({ ...f, in_context: !next }); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[82vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-gray-200 px-5 py-3">
          <Icon className="h-5 w-5 text-brand-600" />
          <span className="flex-1 truncate text-sm font-semibold text-gray-900" title={f?.name}>{f?.name || tr("文件详情", "File")}</span>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[64vh] overflow-y-auto p-5">
          {loading && <div className="grid h-24 place-items-center text-sm text-gray-400">{tr("加载中…", "Loading…")}</div>}
          {!loading && f && (
            <>
              {f.kind === "image" && (
                <img src={dl} alt={f.name} className="mb-4 max-h-56 w-full rounded-lg border border-gray-200 object-contain"
                     onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              )}
              <table className="w-full text-[13px]">
                <tbody>
                  {[
                    [tr("类型", "Kind"), f.kind],
                    [tr("大小", "Size"), fmtSize(f.size_bytes)],
                    [tr("目录", "Folder"), f.folder],
                    [tr("Token 估算", "Tokens"), f.token_estimate ?? "—"],
                    [tr("创建时间", "Created"), f.created_at || "—"],
                    [tr("描述", "Description"), f.description || "—"],
                  ].map(([k, v], i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1.5 pr-3 text-gray-400">{k}</td>
                      <td className="py-1.5 text-gray-700">{String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 关联对象 */}
              <div className="mt-4">
                <div className="mb-1 text-[12px] font-medium text-gray-500">{tr("关联对象", "Linked objects")}</div>
                {(f.links && f.links.length) ? f.links.map((l) => (
                  <div key={l.link_id} className="flex items-center gap-1.5 py-0.5 text-[12.5px] text-gray-700">
                    <Link2 className="h-3.5 w-3.5 text-gray-400" />
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px]">{l.object_type}/{l.object_id ?? "*"}</code>
                  </div>
                )) : <div className="text-[12px] text-gray-400">{tr("未关联对象", "None")}</div>}
              </div>

              {/* 操作 */}
              <div className="mt-5 flex items-center gap-2">
                <button type="button" onClick={toggleCtx}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium ${f.in_context ? "bg-brand-50 text-brand-700 ring-1 ring-brand-200" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                  <Star className={`h-4 w-4 ${f.in_context ? "fill-brand-500 text-brand-500" : ""}`} />
                  {f.in_context ? tr("已纳入上下文", "In context") : tr("纳入上下文", "Add to context")}
                </button>
                <a href={dl} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[13px] font-medium text-gray-700 hover:border-brand-300 hover:bg-brand-50">
                  <Download className="h-4 w-4" /> {tr("下载", "Download")}
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
