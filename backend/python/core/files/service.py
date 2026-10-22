"""Providers behind `/api/v1/files`.

All identifiers are provider-local; callers must never turn an id into a path.
The local provider deliberately delegates containment and secret checks to
``agents.workspaces`` so the file viewer has the same boundaries as Jazper.
"""
from __future__ import annotations

import hashlib
import mimetypes
import os
import shutil
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agents import workspaces

MAX_BYTES = 200 * 1024 * 1024
ATTACHMENTS = Path(__file__).resolve().parents[4] / "storage" / "attachments"


@dataclass(frozen=True)
class FileRef:
    src: str
    id: str
    name: str
    mime: str = "application/octet-stream"
    size: int | None = None
    modified: str | None = None
    webUrl: str | None = None
    path: str | None = None

    def json(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


def _mime(name: str, fallback: str = "application/octet-stream") -> str:
    return mimetypes.guess_type(name)[0] or fallback


def _stamp(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


class FileService:
    sources = ("drive", "local", "attachment", "storage", "url")

    def __init__(self) -> None:
        ATTACHMENTS.mkdir(parents=True, exist_ok=True)

    def source_info(self) -> list[dict[str, str]]:
        return [
            {"id": "drive", "label": "Google Drive"},
            {"id": "local", "label": "This PC (allowed folders)"},
            {"id": "attachment", "label": "Chat attachments"},
            {"id": "storage", "label": "Storage"},
            {"id": "url", "label": "Secure web link"},
        ]

    def _local(self, raw: str) -> Path:
        path, why = workspaces.resolve("jasper", raw)
        if not path:
            raise PermissionError(why)
        return path

    def _ref_path(self, src: str, file_id: str) -> Path:
        if src == "local":
            return self._local(file_id)
        if src == "attachment":
            # attachment ids are generated relative names, not user paths
            path = (ATTACHMENTS / file_id).resolve()
            if ATTACHMENTS.resolve() not in path.parents or not path.is_file():
                raise FileNotFoundError(file_id)
            return path
        raise ValueError(f"{src} is not a disk provider")

    def _disk_ref(self, src: str, path: Path) -> FileRef:
        st = path.stat()
        return FileRef(src, str(path) if src == "local" else path.name, path.name, _mime(path.name), st.st_size, _stamp(st.st_mtime), path=str(path) if src == "local" else None)

    def list(self, src: str, q: str = "", path: str = "", limit: int = 100) -> list[FileRef]:
        if src not in self.sources:
            raise ValueError("unknown source")
        q = q.casefold().strip()
        if src in ("local", "attachment"):
            root = self._local(path) if src == "local" and path else (ATTACHMENTS if src == "attachment" else None)
            if src == "local" and root is None:
                return [FileRef("local", r["path"], r.get("label") or Path(r["path"]).name, "inode/directory") for r in workspaces.roots_for("jasper")]
            if not root or not root.is_dir():
                raise NotADirectoryError(path or "attachments")
            rows: list[FileRef] = []
            for child in sorted(root.iterdir(), key=lambda x: (not x.is_dir(), x.name.casefold())):
                if src == "local" and (child.name.casefold() in workspaces.SKIP_DIRS or workspaces._denied(child)):
                    continue
                if q and q not in child.name.casefold():
                    continue
                rows.append(self._disk_ref(src, child))
                if len(rows) >= limit:
                    break
            return rows
        if src == "drive":
            from core.services import drive_service
            rows = drive_service.search(q, limit) if q else drive_service.list_recent(limit)
            return [FileRef("drive", r["id"], r.get("name", r["id"]), r.get("mimeType", "application/octet-stream"), int(r["size"]) if str(r.get("size", "")).isdigit() else None, r.get("modifiedTime"), r.get("webViewLink")) for r in rows]
        if src == "storage":
            from core import objectstore
            try:
                return [FileRef("storage", x["key"], Path(x["key"]).name, _mime(x["key"]), x.get("size"), x.get("modified")) for x in objectstore.list_keys("backups")[:limit] if not q or q in x["key"].casefold()]
            except Exception as exc:
                raise RuntimeError(f"storage unavailable: {exc}") from exc
        return []

    def meta(self, src: str, file_id: str) -> FileRef:
        if src in ("local", "attachment"):
            return self._disk_ref(src, self._ref_path(src, file_id))
        if src == "drive":
            return self.list("drive", "", limit=1)[0] if False else self._drive_meta(file_id)
        if src == "storage":
            from core import objectstore
            st = objectstore.stat("backups", file_id)
            if not st: raise FileNotFoundError(file_id)
            return FileRef("storage", file_id, Path(file_id).name, st.get("content_type") or _mime(file_id), st.get("size"))
        raise ValueError("unsupported source")

    def _drive_meta(self, file_id: str) -> FileRef:
        from core.services import drive_service
        r = drive_service.get_file(file_id)
        return FileRef("drive", r["id"], r.get("name", file_id), r.get("mimeType", "application/octet-stream"), int(r["size"]) if str(r.get("size", "")).isdigit() else None, r.get("modifiedTime"), r.get("webViewLink"))

    def open_path(self, src: str, file_id: str, mode: str = "raw") -> tuple[Path, str, FileRef]:
        if src in ("local", "attachment"):
            path = self._ref_path(src, file_id)
            if path.stat().st_size > MAX_BYTES:
                raise OverflowError("file exceeds the 200 MB viewer limit")
            return path, _mime(path.name), self._disk_ref(src, path)
        if src == "drive":
            from core.services import drive_service
            path, mime, meta = drive_service.view_file(file_id, "pdf" if mode == "pdf" else "auto")
            return path, mime, self._drive_meta(meta["id"])
        raise ValueError("this source cannot be opened yet")

    def save_attachment(self, name: str, data: bytes, mime: str = "") -> FileRef:
        if not data: raise ValueError("empty file")
        if len(data) > MAX_BYTES: raise OverflowError("file exceeds the 200 MB viewer limit")
        safe = "".join(c if c.isalnum() or c in ".-_" else "_" for c in name)[:120] or "file"
        key = f"{hashlib.sha256(data).hexdigest()[:16]}-{safe}"
        path = ATTACHMENTS / key
        path.write_bytes(data)
        return self._disk_ref("attachment", path)

    def write_text(self, src: str, file_id: str, text: str) -> FileRef:
        if len(text.encode("utf-8")) > MAX_BYTES: raise OverflowError("text exceeds the 200 MB viewer limit")
        if src == "local":
            path = self._local(file_id)
            if path.exists(): shutil.copy2(path, path.with_name(path.name + ".jasper-bak"))
            path.parent.mkdir(parents=True, exist_ok=True); path.write_text(text, encoding="utf-8")
            return self._disk_ref(src, path)
        if src == "attachment":
            path = self._ref_path(src, file_id); shutil.copy2(path, path.with_name(path.name + ".jasper-bak")); path.write_text(text, encoding="utf-8")
            return self._disk_ref(src, path)
        if src == "drive":
            from core.services import drive_service
            drive_service.update_file_text(file_id, text)
            return self._drive_meta(file_id)
        raise ValueError("writing is unsupported for this source")

    def capabilities(self) -> dict[str, Any]:
        tools = {"libreoffice": shutil.which("soffice"), "ffmpeg": shutil.which("ffmpeg"), "7zip": shutil.which("7z") or shutil.which("7zz")}
        return {"maxBytes": MAX_BYTES, "tools": {k: {"available": bool(v), "path": v, "install": cmd} for k, v, cmd in (("libreoffice", tools["libreoffice"], "winget install TheDocumentFoundation.LibreOffice"), ("ffmpeg", tools["ffmpeg"], "winget install Gyan.FFmpeg"), ("7zip", tools["7zip"], "winget install 7zip.7zip"))}, "modes": ["raw", "text", "html", "pdf", "thumb"]}


file_service = FileService()
