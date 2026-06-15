import { useCallback, useEffect, useState } from "react";
import {
  Upload, Search, Folder, FolderOpen, FileText, Image as ImageIcon,
  Music, Video, FileArchive, File as FileIcon, Download, Trash2, Plus, X,
  type LucideIcon,
} from "lucide-react";
import Layout from "../components/layout/Layout";
import { Badge, Button, Card, Modal, Spinner, TextField } from "../components/ui";
import { StatCards, EmptyState } from "../components/segment/kit";
import { useTenant } from "../context/TenantContext";
import { useLang } from "../context/LangContext";
import { OBJECTS } from "../lib/objects";
import {
  listKbFiles, listKbFolders, uploadKbFile, deleteKbFile,
  addKbLink, removeKbLink, getKbFile, kbDownloadUrl,
  type KbFile,
} from "../api/kb";

// 可关联的对象类型（user/store/order/product/account）
const OBJECT_TYPES = OBJECTS.filter((o) => o.kind === "object");

// 字节 → 人类可读
function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || v % 1 === 0 ? 0 : 1)} ${units[i]}`;
}

const KIND_ICON: Record<string, LucideIcon> = {
  document: FileText, image: ImageIcon, audio: Music, video: Video, archive: FileArchive, other: FileIcon,
};
function kindIcon(kind: string): LucideIcon {
  return KIND_ICON[kind] || FileIcon;
}

export default function KnowledgeBasePage() {
  const { tenant } = useTenant();
  const { tr } = useLang();

  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<KbFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 筛选
  const [folder, setFolder] = useState<string>("");   // "" = 全部
  const [kind, setKind] = useState<string>("");        // "" = 全部
  const [q, setQ] = useState("");

  // 弹窗
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selected, setSelected] = useState<KbFile | null>(null);

  const KIND_CHIPS: { value: string; label: string }[] = [
    { value: "", label: tr("全部", "All") },
    { value: "document", label: tr("文档", "Document") },
    { value: "image", label: tr("图片", "Image") },
    { value: "audio", label: tr("音频", "Audio") },
    { value: "video", label: tr("视频", "Video") },
    { value: "other", label: tr("其他", "Other") },
  ];

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [fl, fs] = await Promise.all([
        listKbFolders(tenant),
        listKbFiles({
          tenant_id: tenant,
          folder: folder || undefined,
          kind: kind || undefined,
          q: q.trim() || undefined,
        }),
      ]);
      setFolders(fl);
      setFiles(fs);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || tr("加载失败", "Failed to load"));
    } finally {
      setLoading(false);
    }
  }, [tenant, folder, kind, q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const totalSize = files.reduce((sum, f) => sum + (f.size_bytes || 0), 0);
  const linkedCount = files.filter((f) => f.links.length > 0).length;

  return (
    <Layout
      title={tr("知识库 Knowledge Base", "Knowledge Base")}
      subtitle={tr("云盘式多模态文件存储，可关联到对象", "Cloud-drive multimodal storage, linkable to objects")}
      actions={
        <Button onClick={() => setUploadOpen(true)}>
          <Upload className="h-4 w-4" /> {tr("上传", "Upload")}
        </Button>
      }
    >
      <StatCards
        items={[
          { label: tr("文件数", "Files"), value: files.length },
          { label: tr("总大小", "Total size"), value: formatSize(totalSize) },
          { label: tr("目录数", "Folders"), value: folders.length },
          { label: tr("已关联", "Linked"), value: linkedCount },
        ]}
      />

      {/* 工具栏：搜索 + 类型筛选 */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex max-w-xs flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            className="w-full text-sm focus:outline-none"
            placeholder={tr("搜索文件名…", "Search file name…")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {KIND_CHIPS.map((c) => (
            <button
              key={c.value || "all"}
              onClick={() => setKind(c.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                kind === c.value
                  ? "border-brand-300 bg-brand-50 text-brand-700"
                  : "border-gray-200 bg-white text-gray-500 hover:text-gray-800"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <Card className="mb-4 border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</Card>
      )}

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* 左：目录树 */}
        <div className="w-full shrink-0 lg:w-52">
          <Card className="p-2">
            <FolderItem
              icon={FolderOpen}
              label={tr("全部", "All")}
              active={folder === ""}
              onClick={() => setFolder("")}
            />
            {folders.map((f) => (
              <FolderItem
                key={f}
                icon={Folder}
                label={f}
                active={folder === f}
                onClick={() => setFolder(f)}
              />
            ))}
            {folders.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400">{tr("暂无目录", "No folders")}</div>
            )}
          </Card>
        </div>

        {/* 右：文件网格 */}
        <div className="min-w-0 flex-1">
          {loading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : files.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={tr("暂无文件", "No files")}
              desc={tr("点右上角「上传」添加你的第一个文件", "Click Upload to add your first file")}
              action={<Button onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4" /> {tr("上传", "Upload")}</Button>}
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {files.map((f) => {
                const Icon = kindIcon(f.kind);
                return (
                  <button
                    key={f.id}
                    onClick={() => setSelected(f)}
                    className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-left transition-shadow hover:border-brand-300 hover:shadow-md"
                  >
                    <div className="flex h-24 w-full items-center justify-center bg-gray-50">
                      {f.kind === "image" ? (
                        <img src={kbDownloadUrl(tenant, f.id)} alt={f.name} className="h-24 w-full object-cover" />
                      ) : (
                        <Icon className="h-10 w-10 text-brand-400" />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5 p-3">
                      <div className="truncate text-sm font-medium text-gray-900" title={f.name}>{f.name}</div>
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>{formatSize(f.size_bytes)}</span>
                        <Badge color="gray">{f.folder}</Badge>
                      </div>
                      {f.links.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {f.links.map((l) => (
                            <Badge key={l.link_id} color="brand">
                              {l.object_type}{l.object_id ? `:${l.object_id}` : ""}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <UploadModal
        open={uploadOpen}
        tenant={tenant}
        onClose={() => setUploadOpen(false)}
        onDone={() => { setUploadOpen(false); load(); }}
      />

      <DetailModal
        file={selected}
        tenant={tenant}
        onClose={() => setSelected(null)}
        onChanged={(f) => setSelected(f)}
        onDeleted={() => { setSelected(null); load(); }}
        onLinksChanged={load}
      />
    </Layout>
  );
}

function FolderItem({ icon: Icon, label, active, onClick }: {
  icon: LucideIcon; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        active ? "bg-brand-50 font-medium text-brand-700" : "text-gray-600 hover:bg-gray-50"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate" title={label}>{label}</span>
    </button>
  );
}

// ---- 上传弹窗 ----
function UploadModal({ open, tenant, onClose, onDone }: {
  open: boolean; tenant: number; onClose: () => void; onDone: () => void;
}) {
  const { tr } = useLang();
  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState("/");
  const [description, setDescription] = useState("");
  const [objectType, setObjectType] = useState("");
  const [objectId, setObjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 打开时重置
  useEffect(() => {
    if (open) {
      setFile(null); setFolder("/"); setDescription("");
      setObjectType(""); setObjectId(""); setErr(null); setBusy(false);
    }
  }, [open]);

  async function submit() {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      await uploadKbFile(tenant, file, {
        folder: folder.trim() || "/",
        description: description.trim() || undefined,
        object_type: objectType || undefined,
        object_id: objectId.trim() || undefined,
      });
      onDone();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || tr("上传失败", "Upload failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={tr("上传文件", "Upload file")} onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">{tr("文件", "File")}</span>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-600 hover:file:bg-brand-100"
          />
          {file && <div className="mt-1 text-xs text-gray-400">{file.name} · {formatSize(file.size)}</div>}
        </label>

        <TextField label={tr("目录", "Folder")} value={folder} onChange={setFolder} placeholder={tr("如 /合同/2026", "e.g. /contracts/2026")} />
        <TextField label={tr("描述", "Description")} value={description} onChange={setDescription} placeholder={tr("可选", "Optional")} />

        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700">{tr("关联对象（可选）", "Link object (optional)")}</span>
          <div className="flex gap-2">
            <select
              value={objectType}
              onChange={(e) => setObjectType(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              <option value="">{tr("不关联", "None")}</option>
              {OBJECT_TYPES.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
            <input
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              value={objectId}
              onChange={(e) => setObjectId(e.target.value)}
              placeholder={tr("如 A3001，可空", "e.g. A3001, optional")}
            />
          </div>
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{tr("取消", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy || !file}>
            {busy ? <Spinner /> : <Upload className="h-4 w-4" />} {tr("上传", "Upload")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---- 详情弹窗 ----
function DetailModal({ file, tenant, onClose, onChanged, onDeleted, onLinksChanged }: {
  file: KbFile | null;
  tenant: number;
  onClose: () => void;
  onChanged: (f: KbFile) => void;
  onDeleted: () => void;
  onLinksChanged: () => void;
}) {
  const { tr } = useLang();
  const [newType, setNewType] = useState("");
  const [newId, setNewId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (file) { setNewType(""); setNewId(""); setErr(null); setBusy(false); }
  }, [file?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!file) return null;
  const Icon = kindIcon(file.kind);

  async function refresh() {
    if (!file) return;
    const fresh = await getKbFile(tenant, file.id);
    onChanged(fresh);
    onLinksChanged();
  }

  async function addLink() {
    if (!file || !newType) return;
    setBusy(true); setErr(null);
    try {
      await addKbLink(tenant, file.id, newType, newId.trim() || undefined);
      setNewType(""); setNewId("");
      await refresh();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || tr("关联失败", "Failed to link"));
    } finally { setBusy(false); }
  }

  async function dropLink(linkId: number) {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      await removeKbLink(tenant, file.id, linkId);
      await refresh();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || tr("移除失败", "Failed to remove"));
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!file) return;
    if (!window.confirm(tr("确认删除该文件？此操作不可撤销。", "Delete this file? This cannot be undone."))) return;
    setBusy(true); setErr(null);
    try {
      await deleteKbFile(tenant, file.id);
      onDeleted();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || tr("删除失败", "Failed to delete"));
      setBusy(false);
    }
  }

  return (
    <Modal open={!!file} title={file.name} onClose={onClose}>
      <div className="space-y-4">
        {/* 预览 */}
        <div className="flex items-center justify-center rounded-xl bg-gray-50 p-3">
          {file.kind === "image" ? (
            <img src={kbDownloadUrl(tenant, file.id)} alt={file.name} className="max-h-64 rounded-lg object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 py-6 text-gray-400">
              <Icon className="h-12 w-12 text-brand-400" />
              <span className="text-xs">{file.name}</span>
            </div>
          )}
        </div>

        {/* 元信息 */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Meta label={tr("类型", "Kind")} value={file.kind} />
          <Meta label={tr("大小", "Size")} value={formatSize(file.size_bytes)} />
          <Meta label={tr("目录", "Folder")} value={file.folder} />
          <Meta label={tr("创建时间", "Created")} value={file.created_at || "—"} />
          {file.description && <div className="col-span-2"><Meta label={tr("描述", "Description")} value={file.description} /></div>}
        </dl>

        <a href={kbDownloadUrl(tenant, file.id)} download>
          <Button variant="outline" className="w-full">
            <Download className="h-4 w-4" /> {tr("下载", "Download")}
          </Button>
        </a>

        {/* 关联对象 */}
        <div>
          <div className="mb-2 text-sm font-medium text-gray-700">{tr("关联对象", "Linked objects")}</div>
          <div className="space-y-1.5">
            {file.links.length === 0 && (
              <div className="text-xs text-gray-400">{tr("暂无关联", "No links")}</div>
            )}
            {file.links.map((l) => (
              <div key={l.link_id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-1.5 text-sm">
                <span className="text-gray-700">{l.object_type}{l.object_id ? `:${l.object_id}` : ""}</span>
                <button
                  onClick={() => dropLink(l.link_id)}
                  disabled={busy}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500 disabled:opacity-50"
                  title={tr("移除", "Remove")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-2 flex gap-2">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
            >
              <option value="">{tr("对象类型", "Object type")}</option>
              {OBJECT_TYPES.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
            <input
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-400 focus:outline-none"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder={tr("对象 ID，可空", "Object ID, optional")}
            />
            <Button variant="outline" onClick={addLink} disabled={busy || !newType}>
              <Plus className="h-4 w-4" /> {tr("添加", "Add")}
            </Button>
          </div>
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <div className="flex justify-between border-t border-gray-100 pt-3">
          <Button variant="outline" onClick={remove} disabled={busy} className="!text-red-600 hover:!bg-red-50">
            <Trash2 className="h-4 w-4" /> {tr("删除", "Delete")}
          </Button>
          <Button variant="outline" onClick={onClose}>{tr("关闭", "Close")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 break-words text-gray-700">{value}</dd>
    </div>
  );
}
