"""Providers behind `/api/v1/files`.

All identifiers are provider-local; callers must never turn an id into a path.
The local provider deliberately delegates containment and secret checks to
``agents.workspaces`` so the file viewer has the same boundaries as Jazper.
"""
from __future__ import annotations

import hashlib
import ipaddress
import mimetypes
import os
import shutil
import socket
import subprocess
import tarfile
import zipfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from agents import workspaces

MAX_BYTES = 200 * 1024 * 1024
ATTACHMENTS = Path(__file__).resolve().parents[4] / "storage" / "attachments"
URL_CACHE = Path(__file__).resolve().parents[4] / "storage" / "url_cache"
STORAGE_CACHE = Path(__file__).resolve().parents[4] / "storage" / "object_cache"
TRASH = Path(__file__).resolve().parents[4] / "storage" / "file_trash"
LOCAL_SKIP_NAMES = {"$recycle.bin", "system volume information", "recovery"}


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
        URL_CACHE.mkdir(parents=True, exist_ok=True)
        STORAGE_CACHE.mkdir(parents=True, exist_ok=True)
        TRASH.mkdir(parents=True, exist_ok=True)

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
        mime = "inode/directory" if path.is_dir() else _mime(path.name)
        name = path.name.split("-", 1)[1] if src == "attachment" and "-" in path.name else path.name
        return FileRef(src, str(path) if src == "local" else path.name, name, mime, st.st_size, _stamp(st.st_mtime), path=str(path) if src == "local" else None)

    def _validate_url(self, raw: str) -> tuple[str, str]:
        """Validate before fetching: HTTPS only, optional host allow-list, public IPs only."""
        if os.getenv("JASPER_FILES_ALLOW_URLS", "0").lower() not in {"1", "true", "yes"}:
            raise PermissionError("URL files are disabled; enable JASPER_FILES_ALLOW_URLS in Settings first")
        parsed = urlsplit(raw)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("only plain https URLs are allowed")
        allowed = [h.strip().lower() for h in os.getenv("JASPER_FILES_URL_ALLOWLIST", "").split(",") if h.strip()]
        host = parsed.hostname.lower()
        if allowed and not any(host == h or host.endswith("." + h) for h in allowed):
            raise PermissionError("URL host is not in the configured allow-list")
        try:
            ips = {row[4][0] for row in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
        except OSError as exc:
            raise ValueError("could not resolve URL host") from exc
        if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
            raise PermissionError("private, loopback and link-local URL hosts are blocked")
        return raw, host

    def _url_ref(self, raw: str) -> FileRef:
        raw, _ = self._validate_url(raw)
        parsed = urlsplit(raw)
        name = Path(parsed.path).name or parsed.hostname or "download"
        return FileRef("url", raw, name, _mime(name), webUrl=raw)

    def _download_url(self, raw: str) -> tuple[Path, str, FileRef]:
        raw, host = self._validate_url(raw)
        key = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        payload, meta = URL_CACHE / key, URL_CACHE / f"{key}.meta"
        if payload.exists() and meta.exists() and payload.stat().st_size <= MAX_BYTES:
            mime = meta.read_text("utf-8").strip() or _mime(urlsplit(raw).path)
            ref = self._url_ref(raw)
            return payload, mime, FileRef(**{**ref.json(), "size": payload.stat().st_size, "modified": _stamp(payload.stat().st_mtime)})
        import httpx
        with httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0), follow_redirects=False) as client:
            with client.stream("GET", raw, headers={"User-Agent": "Jazper-FileViewer/1.0"}) as response:
                response.raise_for_status()
                # Redirects are intentionally not followed: every destination must pass SSRF checks.
                length = int(response.headers.get("content-length") or 0)
                if length > MAX_BYTES: raise OverflowError("remote file exceeds the 200 MB viewer limit")
                tmp = payload.with_suffix(".part")
                size = 0
                with tmp.open("wb") as out:
                    for chunk in response.iter_bytes(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_BYTES:
                            out.close(); tmp.unlink(missing_ok=True); raise OverflowError("remote file exceeds the 200 MB viewer limit")
                        out.write(chunk)
                tmp.replace(payload)
                mime = response.headers.get("content-type", "").split(";", 1)[0] or _mime(urlsplit(raw).path)
                meta.write_text(mime, encoding="utf-8")
        ref = self._url_ref(raw)
        return payload, mime, FileRef(**{**ref.json(), "size": payload.stat().st_size, "modified": _stamp(payload.stat().st_mtime)})

    def list(self, src: str, q: str = "", path: str = "", limit: int = 100) -> list[FileRef]:
        if src not in self.sources:
            raise ValueError("unknown source")
        q = q.casefold().strip()
        if src in ("local", "attachment"):
            root = self._local(path) if src == "local" and path else (ATTACHMENTS if src == "attachment" else None)
            if src == "local" and root is None:
                if q:
                    rows: list[FileRef] = []
                    # Search only permitted roots and never descend into the same protected trees
                    # the workspace service excludes from normal browsing.
                    scanned = 0
                    for item in workspaces.roots_for("jasper"):
                        base = Path(item["path"])
                        try:
                            for parent, dirs, names in os.walk(base):
                                here = Path(parent)
                                dirs[:] = [d for d in dirs if d.casefold() not in LOCAL_SKIP_NAMES and d.casefold() not in workspaces.SKIP_DIRS]
                                if len(here.relative_to(base).parts) >= 4: dirs[:] = []
                                for name in names:
                                    scanned += 1
                                    if scanned > 6000: return rows
                                    child = here / name
                                    if q in name.casefold() and not workspaces._denied(child):
                                        rows.append(self._disk_ref("local", child))
                                        if len(rows) >= limit: return rows
                        except (OSError, PermissionError):
                            continue
                    return rows
                return [FileRef("local", r["path"], r.get("label") or Path(r["path"]).name, "inode/directory") for r in workspaces.roots_for("jasper")]
            if not root or not root.is_dir():
                raise NotADirectoryError(path or "attachments")
            rows: list[FileRef] = []
            for child in sorted(root.iterdir(), key=lambda x: (not x.is_dir(), x.name.casefold())):
                if src == "local" and (child.name.casefold() in LOCAL_SKIP_NAMES or child.name.casefold() in workspaces.SKIP_DIRS or workspaces._denied(child)):
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
        if src == "url":
            return [self._url_ref(q)] if q else []
        return []

    def find(self, query: str, limit: int = 20) -> list[FileRef]:
        """Bounded cross-source search used by chat file references and deterministic fast paths."""
        query = query.strip()
        rows: list[FileRef] = []
        for src in ("drive", "local", "attachment", "storage"):
            try:
                rows.extend(self.list(src, query, limit=min(limit, 12)))
            except Exception:
                continue
            if len(rows) >= limit:
                break
        if query.startswith("https://"):
            try: rows.append(self._url_ref(query))
            except Exception: pass
        # De-duplicate while retaining source order. Exact filename matches should surface first.
        rows = list({(row.src, row.id): row for row in rows}.values())
        if not query:
            return rows[:limit]
        folded = query.casefold()
        return sorted(rows, key=lambda row: (row.name.casefold() != folded, row.name.casefold().find(folded) < 0, row.name.casefold()))[:limit]

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
        if src == "url":
            return self._url_ref(file_id)
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
            if mode in {"pdf", "html"} and path.suffix.lower() in {".doc", ".docx", ".odt", ".rtf", ".ppt", ".pptx", ".xls", ".xlsx", ".ods"}:
                from core.files.converters import office_to_pdf
                converted = office_to_pdf(path, _stamp(path.stat().st_mtime))
                return converted, "application/pdf", self._disk_ref(src, path)
            if mode == "thumb":
                from core.files.converters import image_thumb, media_thumb
                stamp = _stamp(path.stat().st_mtime)
                if _mime(path.name).startswith("image/"):
                    thumb = image_thumb(path, stamp)
                elif _mime(path.name).startswith(("video/", "audio/")):
                    thumb = media_thumb(path, stamp)
                else:
                    raise ValueError("thumbnails are not available for this file type")
                return thumb, "image/jpeg", self._disk_ref(src, path)
            if mode == "transcode":
                from core.files.converters import video_to_mp4
                converted = video_to_mp4(path, _stamp(path.stat().st_mtime))
                return converted, "video/mp4", self._disk_ref(src, path)
            if mode == "jpeg":
                from core.files.converters import image_to_jpeg
                converted = image_to_jpeg(path, _stamp(path.stat().st_mtime))
                return converted, "image/jpeg", self._disk_ref(src, path)
            if mode == "epub":
                from core.files.converters import ebook_to_epub
                converted = ebook_to_epub(path, _stamp(path.stat().st_mtime))
                return converted, "application/epub+zip", self._disk_ref(src, path)
            if mode == "subtitle":
                vtt, srt = path.with_suffix(".vtt"), path.with_suffix(".srt")
                if vtt.is_file(): return vtt, "text/vtt", self._disk_ref(src, path)
                if srt.is_file():
                    from core.files.converters import srt_to_vtt
                    converted = srt_to_vtt(srt, _stamp(srt.stat().st_mtime))
                    return converted, "text/vtt", self._disk_ref(src, path)
                raise FileNotFoundError("no .vtt or .srt subtitle sidecar was found")
            if mode == "lyrics":
                lrc = path.with_suffix(".lrc")
                if not lrc.is_file(): raise FileNotFoundError("no .lrc lyrics sidecar was found")
                if lrc.stat().st_size > 2 * 1024 * 1024: raise OverflowError("lyrics sidecar is too large")
                return lrc, "text/plain", self._disk_ref(src, path)
            return path, _mime(path.name), self._disk_ref(src, path)
        if src == "drive":
            from core.services import drive_service
            path, mime, meta = drive_service.view_file(file_id, "pdf" if mode == "pdf" else "auto")
            return path, mime, self._drive_meta(meta["id"])
        if src == "url":
            return self._download_url(file_id)
        if src == "storage":
            from core import objectstore
            ref = self.meta("storage", file_id)
            if ref.size is not None and ref.size > MAX_BYTES: raise OverflowError("file exceeds the 200 MB viewer limit")
            key = hashlib.sha256(file_id.encode("utf-8")).hexdigest()
            path = STORAGE_CACHE / key
            if not path.exists():
                tmp = path.with_suffix(".part")
                try:
                    objectstore.download_file("backups", file_id, str(tmp), MAX_BYTES)
                    tmp.replace(path)
                finally:
                    tmp.unlink(missing_ok=True)
            return path, ref.mime, ref
        raise ValueError("this source cannot be opened yet")

    def save_attachment(self, name: str, data: bytes, mime: str = "") -> FileRef:
        if not data: raise ValueError("empty file")
        if len(data) > MAX_BYTES: raise OverflowError("file exceeds the 200 MB viewer limit")
        safe = "".join(c if c.isalnum() or c in ".-_" else "_" for c in name)[:120] or "file"
        key = f"{hashlib.sha256(data).hexdigest()[:16]}-{safe}"
        path = ATTACHMENTS / key
        path.write_bytes(data)
        return self._disk_ref("attachment", path)

    def save_attachment_path(self, name: str, temp: Path, mime: str = "") -> FileRef:
        size = temp.stat().st_size
        if not size: raise ValueError("empty file")
        if size > MAX_BYTES: raise OverflowError("file exceeds the 200 MB viewer limit")
        digest = hashlib.sha256()
        with temp.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""): digest.update(chunk)
        safe = "".join(c if c.isalnum() or c in ".-_" else "_" for c in name)[:120] or "file"
        target = ATTACHMENTS / f"{digest.hexdigest()[:16]}-{safe}"
        shutil.move(str(temp), str(target))
        return self._disk_ref("attachment", target)

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
            meta = drive_service.get_file(file_id)
            if meta.get("mimeType") == "application/vnd.google-apps.document": drive_service.docs_replace_all(file_id, text)
            else: drive_service.update_file_text(file_id, text)
            return self._drive_meta(file_id)
        raise ValueError("writing is unsupported for this source")

    def write_cells(self, src: str, file_id: str, changes: list[dict[str, Any]]) -> FileRef:
        if src != "drive": raise ValueError("cell editing is currently available for Google Sheets")
        from core.services import drive_service
        meta = drive_service.get_file(file_id)
        if meta.get("mimeType") != "application/vnd.google-apps.spreadsheet": raise ValueError("this is not a Google Sheet")
        for change in changes[:500]:
            cell = str(change.get("cell", ""))
            if not cell: continue
            drive_service.sheets_write(file_id, cell, [[change.get("value", "")]])
        return self._drive_meta(file_id)

    def rename(self, src: str, file_id: str, new_name: str) -> FileRef:
        safe = Path(new_name).name
        if not safe or safe in {".", ".."} or safe != new_name or any(c in safe for c in '<>:"/\\|?*'):
            raise ValueError("invalid file name")
        if src in ("local", "attachment"):
            path = self._ref_path(src, file_id)
            target = path.with_name(safe)
            if target.exists(): raise FileExistsError("a file with that name already exists")
            path.rename(target)
            return self._disk_ref(src, target)
        if src == "drive":
            from core.services import drive_service
            drive_service.rename_file(file_id, safe)
            return self._drive_meta(file_id)
        raise ValueError("renaming is unsupported for this source")

    def trash(self, src: str, file_id: str) -> dict[str, Any]:
        if src in ("local", "attachment"):
            path = self._ref_path(src, file_id)
            target = TRASH / f"{int(path.stat().st_mtime)}-{path.name}"
            shutil.move(str(path), str(target))
            return {"trashed": True, "recoverablePath": str(target)}
        if src == "drive":
            from core.services import drive_service
            drive_service.trash_file(file_id)
            return {"trashed": True, "recoverablePath": "Google Drive Trash"}
        raise ValueError("trash is unsupported for this source")

    def copy(self, src: str, file_id: str, destination: str = "", name: str = "") -> FileRef:
        if src in ("local", "attachment"):
            path = self._ref_path(src, file_id)
            folder = self._local(destination) if destination else path.parent
            if not folder.is_dir(): raise NotADirectoryError(destination)
            target = folder / (Path(name).name if name else path.name)
            if target.exists(): raise FileExistsError("destination already has that file")
            shutil.copy2(path, target)
            return self._disk_ref("attachment" if src == "attachment" and ATTACHMENTS.resolve() in target.resolve().parents else "local", target)
        if src == "drive":
            from core.services import drive_service
            result = drive_service.copy_file(file_id, name or None, destination or None)
            return FileRef("drive", result["id"], result.get("name", name), result.get("mimeType", "application/octet-stream"), webUrl=result.get("webViewLink"))
        raise ValueError("copying is unsupported for this source")

    def move(self, src: str, file_id: str, destination: str) -> FileRef:
        if src in ("local", "attachment"):
            path, folder = self._ref_path(src, file_id), self._local(destination)
            if not folder.is_dir(): raise NotADirectoryError(destination)
            target = folder / path.name
            if target.exists(): raise FileExistsError("destination already has that file")
            shutil.move(str(path), str(target)); return self._disk_ref("local", target)
        if src == "drive":
            from core.services import drive_service
            result = drive_service.move_file(file_id, destination)
            return FileRef("drive", result["id"], result.get("name", file_id), result.get("mimeType", "application/octet-stream"), webUrl=result.get("webViewLink"))
        raise ValueError("moving is unsupported for this source")

    def share(self, src: str, file_id: str, email: str, role: str = "reader") -> dict[str, Any]:
        if src != "drive": raise ValueError("sharing is available for Google Drive files")
        if role not in {"reader", "commenter", "writer"}: raise ValueError("role must be reader, commenter or writer")
        from core.services import drive_service
        return drive_service.share_file(file_id, email, role)

    @staticmethod
    def _safe_archive_name(name: str) -> bool:
        candidate = Path(name.replace("\\", "/"))
        return bool(name) and not candidate.is_absolute() and ".." not in candidate.parts

    def archive_entries(self, src: str, file_id: str) -> list[dict[str, Any]]:
        """List archives without extracting or trusting paths from their index."""
        if src not in ("local", "attachment"):
            raise ValueError("archive listing is available for local files and attachments")
        archive = self._ref_path(src, file_id)
        suffix = archive.suffix.lower()
        if suffix == ".zip":
            with zipfile.ZipFile(archive) as zf:
                return [{"name": x.filename, "dir": x.is_dir(), "size": x.file_size} for x in zf.infolist() if self._safe_archive_name(x.filename)][:2000]
        if suffix in {".tar", ".gz", ".tgz", ".bz2", ".xz"}:
            with tarfile.open(archive, "r:*") as tf:
                return [{"name": x.name, "dir": x.isdir(), "size": x.size} for x in tf.getmembers() if self._safe_archive_name(x.name)][:2000]
        seven_zip = shutil.which("7z") or shutil.which("7zz")
        if not seven_zip:
            raise RuntimeError("converter missing: install 7-Zip (winget install 7zip.7zip)")
        result = subprocess.run([seven_zip, "l", "-ba", str(archive)], capture_output=True, text=True, timeout=45, check=False)
        if result.returncode != 0:
            raise RuntimeError((result.stderr or "7-Zip could not list archive")[-500:])
        rows: list[dict[str, Any]] = []
        for line in result.stdout.splitlines():
            parts = line.split(maxsplit=5)
            if len(parts) < 6 or parts[0].startswith("-"):
                continue
            name = parts[-1].strip()
            if self._safe_archive_name(name):
                rows.append({"name": name, "dir": line[20:25].strip().startswith("D"), "size": int(parts[3]) if parts[3].isdigit() else None})
            if len(rows) >= 2000:
                break
        return rows

    def extract_archive(self, src: str, file_id: str, destination: str) -> dict[str, Any]:
        if src not in ("local", "attachment"): raise ValueError("archive extraction is available for local files and attachments")
        archive, folder = self._ref_path(src, file_id), self._local(destination)
        if not folder.is_dir(): raise NotADirectoryError(destination)
        entries = self.archive_entries(src, file_id)
        if not entries: return {"extracted": 0, "destination": str(folder)}
        if any(not self._safe_archive_name(str(x["name"])) for x in entries):
            raise PermissionError("archive contains a path traversal entry")
        if len(entries) > 1000: raise OverflowError("archive has too many files")
        if any(int(x.get("size") or 0) > MAX_BYTES for x in entries): raise OverflowError("archive entry exceeds viewer size limit")
        suffix = archive.suffix.lower()
        if suffix not in {".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz"}:
            seven_zip = shutil.which("7z") or shutil.which("7zz")
            if not seven_zip: raise RuntimeError("converter missing: install 7-Zip (winget install 7zip.7zip)")
            result = subprocess.run([seven_zip, "x", "-y", f"-o{folder}", str(archive)], capture_output=True, text=True, timeout=180, check=False)
            if result.returncode != 0: raise RuntimeError((result.stderr or "7-Zip extraction failed")[-500:])
            return {"extracted": len(entries), "destination": str(folder)}
        count = 0
        if suffix == ".zip":
            with zipfile.ZipFile(archive) as zf:
                for member in zf.infolist():
                    if not self._safe_archive_name(member.filename):
                        raise PermissionError("archive contains a path traversal entry")
                    target = (folder / member.filename).resolve()
                    if member.is_dir(): target.mkdir(parents=True, exist_ok=True); continue
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(member) as source, target.open("wb") as out: shutil.copyfileobj(source, out, 1024 * 1024)
                    count += 1
        else:
            with tarfile.open(archive, "r:*") as tf:
                for member in tf.getmembers():
                    if not self._safe_archive_name(member.name):
                        raise PermissionError("archive contains a path traversal entry")
                    if not member.isfile():
                        continue
                    target = (folder / member.name).resolve(); target.parent.mkdir(parents=True, exist_ok=True)
                    source = tf.extractfile(member)
                    if source:
                        with source, target.open("wb") as out: shutil.copyfileobj(source, out, 1024 * 1024)
                        count += 1
        return {"extracted": count, "destination": str(folder)}

    def capabilities(self) -> dict[str, Any]:
        tools = {"libreoffice": shutil.which("soffice"), "ffmpeg": shutil.which("ffmpeg"), "7zip": shutil.which("7z") or shutil.which("7zz"), "calibre": shutil.which("ebook-convert")}
        return {"maxBytes": MAX_BYTES, "urlFiles": {"enabled": os.getenv("JASPER_FILES_ALLOW_URLS", "0").lower() in {"1", "true", "yes"}, "allowlist": bool(os.getenv("JASPER_FILES_URL_ALLOWLIST"))}, "tools": {k: {"available": bool(v), "path": v, "install": cmd} for k, v, cmd in (("libreoffice", tools["libreoffice"], "winget install TheDocumentFoundation.LibreOffice"), ("ffmpeg", tools["ffmpeg"], "winget install Gyan.FFmpeg"), ("7zip", tools["7zip"], "winget install 7zip.7zip"), ("calibre", tools["calibre"], "winget install Calibre.Calibre"))}, "modes": ["raw", "text", "html", "pdf", "thumb", "jpeg", "transcode", "subtitle", "lyrics", "epub"]}


file_service = FileService()
