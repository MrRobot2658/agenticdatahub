"""知识库（Knowledge Base）：云盘式多模态文件存储 + 关联到对象。

- 文件字节存盘（KB_STORAGE_DIR，compose 挂 kb_data 卷），元数据/关联落 MySQL（kb_files / kb_links）。
- 支持：上传（multipart）、按目录/对象/关键词/类型列出、详情、下载（流式）、删除、目录列表、加/删对象关联。
- 路由前缀 /kb，经 nginx 暴露为 /api/kb/*。
"""
from __future__ import annotations

import os
import secrets
from contextlib import contextmanager
from pathlib import Path

import pymysql
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from executor import MysqlOlapExecutor

KB_ROOT = Path(os.getenv("KB_STORAGE_DIR", "/data/kb"))


def _kind_of(mime: str, name: str) -> str:
    m = (mime or "").lower()
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if m.startswith("image/"):
        return "image"
    if m.startswith("video/"):
        return "video"
    if m.startswith("audio/"):
        return "audio"
    if m == "application/pdf" or m.startswith("text/") or ext in (
            "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "csv", "md", "txt", "json"):
        return "document"
    if ext in ("zip", "tar", "gz", "rar", "7z"):
        return "archive"
    return "other"


class KbService:
    def __init__(self, executor: MysqlOlapExecutor | None = None):
        self._executor = executor or MysqlOlapExecutor()
        self.config = self._executor.config
        KB_ROOT.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def _conn(self):
        conn = pymysql.connect(**self.config, autocommit=True)
        try:
            yield conn
        finally:
            conn.close()

    @staticmethod
    def _nid() -> str:
        return "kb_" + secrets.token_hex(8)

    def _links(self, cur, file_ids: list[str]) -> dict[str, list]:
        if not file_ids:
            return {}
        ph = ",".join(["%s"] * len(file_ids))
        cur.execute(
            f"SELECT id, file_id, object_type, object_id FROM kb_links WHERE file_id IN ({ph})",
            tuple(file_ids),
        )
        out: dict[str, list] = {}
        for r in cur.fetchall():
            out.setdefault(r["file_id"], []).append(
                {"link_id": r["id"], "object_type": r["object_type"], "object_id": r["object_id"]})
        return out

    def upload(self, tenant_id: int, name: str, folder: str, description: str | None,
               mime: str, data: bytes, object_type: str | None, object_id: str | None) -> dict:
        fid = self._nid()
        ext = ("." + name.rsplit(".", 1)[-1]) if "." in name else ""
        rel = f"{tenant_id}/{fid}{ext}"
        path = KB_ROOT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        kind = _kind_of(mime, name)
        folder = folder or "/"
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                """INSERT INTO kb_files (id, tenant_id, name, folder, mime_type, kind,
                       size_bytes, storage_path, description)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (fid, tenant_id, name, folder, mime, kind, len(data), rel, description),
            )
            if object_type:
                cur.execute(
                    "INSERT INTO kb_links (tenant_id, file_id, object_type, object_id) VALUES (%s,%s,%s,%s)",
                    (tenant_id, fid, object_type, object_id or None),
                )
        return {"id": fid, "name": name, "kind": kind, "size_bytes": len(data), "folder": folder}

    def list_files(self, tenant_id: int, folder: str | None, object_type: str | None,
                   object_id: str | None, q: str | None, kind: str | None) -> list[dict]:
        sql = ["SELECT f.id, f.name, f.folder, f.mime_type, f.kind, f.size_bytes, f.description, f.created_at",
               "FROM kb_files f"]
        params: list = []
        where = ["f.tenant_id=%s"]
        params.append(tenant_id)
        if object_type:
            sql.append("JOIN kb_links l ON l.file_id=f.id")
            where.append("l.object_type=%s")
            params.append(object_type)
            if object_id:
                where.append("l.object_id=%s")
                params.append(object_id)
        if folder:
            where.append("f.folder=%s")
            params.append(folder)
        if kind:
            where.append("f.kind=%s")
            params.append(kind)
        if q:
            where.append("f.name LIKE %s")
            params.append(f"%{q}%")
        full = " ".join(sql) + " WHERE " + " AND ".join(where) + " ORDER BY f.created_at DESC LIMIT 500"
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(full, tuple(params))
            rows = cur.fetchall()
            links = self._links(cur, [r["id"] for r in rows])
        for r in rows:
            r["links"] = links.get(r["id"], [])
            r["created_at"] = str(r["created_at"]) if r.get("created_at") else None
        return rows

    def folders(self, tenant_id: int) -> list[str]:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT DISTINCT folder FROM kb_files WHERE tenant_id=%s ORDER BY folder", (tenant_id,))
            return [r["folder"] for r in cur.fetchall()]

    def get(self, tenant_id: int, fid: str) -> dict:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM kb_files WHERE tenant_id=%s AND id=%s", (tenant_id, fid))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="文件不存在")
            row["links"] = self._links(cur, [fid]).get(fid, [])
            row["created_at"] = str(row.get("created_at")) if row.get("created_at") else None
        return row

    def file_path(self, tenant_id: int, fid: str) -> tuple[Path, str, str]:
        row = self.get(tenant_id, fid)
        return KB_ROOT / row["storage_path"], row["name"], (row.get("mime_type") or "application/octet-stream")

    def delete(self, tenant_id: int, fid: str) -> None:
        row = self.get(tenant_id, fid)
        try:
            (KB_ROOT / row["storage_path"]).unlink(missing_ok=True)
        except OSError:
            pass
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM kb_links WHERE file_id=%s", (fid,))
            cur.execute("DELETE FROM kb_files WHERE tenant_id=%s AND id=%s", (tenant_id, fid))

    def add_link(self, tenant_id: int, fid: str, object_type: str, object_id: str | None) -> dict:
        self.get(tenant_id, fid)  # 校验存在
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO kb_links (tenant_id, file_id, object_type, object_id) VALUES (%s,%s,%s,%s)",
                (tenant_id, fid, object_type, object_id or None),
            )
            return {"link_id": cur.lastrowid, "object_type": object_type, "object_id": object_id}

    def remove_link(self, tenant_id: int, link_id: int) -> None:
        with self._conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM kb_links WHERE tenant_id=%s AND id=%s", (tenant_id, link_id))


service = KbService()
router = APIRouter(prefix="/kb", tags=["knowledge-base"])


@router.post("/files")
async def upload_file(
    tenant_id: int = Form(...), folder: str = Form("/"), description: str | None = Form(None),
    object_type: str | None = Form(None), object_id: str | None = Form(None),
    file: UploadFile = File(...),
):
    data = await file.read()
    return service.upload(tenant_id, file.filename or "file", folder, description,
                          file.content_type or "application/octet-stream", data,
                          object_type, object_id)


@router.get("/files")
def list_files(tenant_id: int = Query(...), folder: str | None = None,
               object_type: str | None = None, object_id: str | None = None,
               q: str | None = None, kind: str | None = None):
    return {"files": service.list_files(tenant_id, folder, object_type, object_id, q, kind)}


@router.get("/folders")
def list_folders(tenant_id: int = Query(...)):
    return {"folders": service.folders(tenant_id)}


@router.get("/files/{fid}")
def get_file(fid: str, tenant_id: int = Query(...)):
    return service.get(tenant_id, fid)


@router.get("/files/{fid}/download")
def download_file(fid: str, tenant_id: int = Query(...)):
    path, name, mime = service.file_path(tenant_id, fid)
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件已丢失")
    return FileResponse(str(path), media_type=mime, filename=name)


@router.delete("/files/{fid}")
def delete_file(fid: str, tenant_id: int = Query(...)):
    service.delete(tenant_id, fid)
    return {"ok": True}


@router.post("/files/{fid}/links")
def add_link(fid: str, tenant_id: int = Query(...), object_type: str = Query(...), object_id: str | None = Query(None)):
    return service.add_link(tenant_id, fid, object_type, object_id)


@router.delete("/files/{fid}/links/{link_id}")
def remove_link(fid: str, link_id: int, tenant_id: int = Query(...)):
    service.remove_link(tenant_id, link_id)
    return {"ok": True}
