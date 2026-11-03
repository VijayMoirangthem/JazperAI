"""Unified source-agnostic file API; the legacy upload URL remains supported."""
from __future__ import annotations

import asyncio
import os
import re
import subprocess
import tempfile
from pathlib import Path
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from starlette.responses import StreamingResponse
from core.files import file_service
from core.files.service import MAX_BYTES
from core.hitl import gate

router = APIRouter()


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, PermissionError): return HTTPException(403, str(exc))
    if isinstance(exc, FileNotFoundError): return HTTPException(404, "file not found")
    if isinstance(exc, OverflowError): return HTTPException(413, str(exc))
    if isinstance(exc, (ValueError, NotADirectoryError)): return HTTPException(400, str(exc))
    return HTTPException(502, str(exc))


async def _run(fn, *args):
    try: return await asyncio.to_thread(fn, *args)
    except Exception as exc: raise _http(exc)


def _range(path: Path, request: Request, mime: str, name: str) -> Response:
    size = path.stat().st_size
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=300", "Content-Disposition": f"inline; filename*=UTF-8''{name}"}
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", request.headers.get("range", ""))
    if not match: return FileResponse(path, media_type=mime, headers=headers)
    first, last = match.groups()
    # RFC 7233 supports both `bytes=START-END` and suffix ranges such as
    # `bytes=-500`, which media engines use while probing a file tail.
    if not first:
        suffix = int(last)
        start, end = max(0, size - suffix), size - 1
    else:
        start, end = int(first), min(int(last) if last else size - 1, size - 1)
    if start > end or start >= size: return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
    def body():
        with path.open("rb") as fh:
            fh.seek(start); left = end - start + 1
            while left:
                chunk = fh.read(min(1024 * 1024, left))
                if not chunk: break
                left -= len(chunk); yield chunk
    return StreamingResponse(body(), 206, media_type=mime, headers={**headers, "Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(end - start + 1)})


@router.get("/sources")
async def sources(): return {"sources": file_service.source_info()}

@router.get("/capabilities")
async def capabilities(): return file_service.capabilities()

@router.post("/capabilities/install")
async def install_capability(body: dict):
    tool = str(body.get("tool", ""))
    caps = file_service.capabilities().get("tools", {})
    if tool not in caps: raise HTTPException(400, "unknown optional tool")
    if caps[tool]["available"]: return {"ok": True, "detail": f"{tool} is already installed"}
    if not await gate("system.install", f"Install optional file viewer dependency {tool}: {caps[tool]['install']}", "jasper"):
        raise HTTPException(403, "installation was not approved")
    command = caps[tool]["install"].split()
    subprocess.Popen(command, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return {"ok": True, "detail": f"Started approved install for {tool}. Restart Jazper after it completes."}

@router.get("")
async def list_files(src: str = "drive", q: str = "", path: str = "", limit: int = 100):
    rows = await _run(file_service.find, q, max(1, min(limit, 200))) if src == "all" else await _run(file_service.list, src, q, path, max(1, min(limit, 200)))
    return {"files": [r.json() for r in rows]}

@router.get("/meta")
async def meta(src: str, id: str): return (await _run(file_service.meta, src, id)).json()

@router.get("/content")
async def content(src: str, id: str, request: Request, mode: str = "raw"):
    if mode not in {"raw", "text", "html", "pdf", "thumb", "transcode", "jpeg", "subtitle", "lyrics", "epub"}: raise HTTPException(400, "unknown content mode")
    path, mime, ref = await _run(file_service.open_path, src, id, mode)
    return _range(path, request, mime, ref.name)

@router.post("/upload")
@router.post("/")
async def upload(file: UploadFile = File(...)):
    fd, raw_tmp = tempfile.mkstemp(prefix="jazper-upload-", suffix=".part")
    os.close(fd)
    tmp = Path(raw_tmp)
    size = 0
    try:
        with tmp.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES: raise HTTPException(413, "file exceeds the 200 MB viewer limit")
                out.write(chunk)
        ref = await _run(file_service.save_attachment_path, file.filename or "file", tmp, file.content_type or "")
    finally:
        tmp.unlink(missing_ok=True)
    value = ref.json(); value.update({"key": ref.id, "url": f"/api/v1/files/content?src=attachment&id={ref.id}"})
    return value

@router.put("/content")
async def write_content(body: dict):
    src, file_id, text = body.get("src"), body.get("id"), body.get("text")
    if not all(isinstance(x, str) for x in (src, file_id, text)): raise HTTPException(422, "src, id and text are required")
    if not await gate("file.write", f"Write {len(text)} chars to {src}:{file_id}", "jasper"): raise HTTPException(403, "write was not approved")
    ref = await _run(file_service.write_text, src, file_id, text)
    from core.eventbus import bus
    bus.publish({"topic": "file-changed", "src": src, "id": file_id, "name": ref.name, "by": "jasper"})
    return ref.json()

@router.post("/manage")
async def manage_file(body: dict):
    src, file_id, action = body.get("src"), body.get("id"), body.get("action")
    if not all(isinstance(x, str) for x in (src, file_id, action)): raise HTTPException(422, "src, id and action are required")
    if action == "rename":
        name = body.get("name")
        if not isinstance(name, str): raise HTTPException(422, "name is required")
        if not await gate("file.rename", f"Rename {src}:{file_id} to {name}", "jasper"): raise HTTPException(403, "rename was not approved")
        ref = await _run(file_service.rename, src, file_id, name)
        from core.eventbus import bus
        bus.publish({"topic": "file-changed", "src": src, "id": ref.id, "name": ref.name, "by": "jasper"})
        return ref.json()
    if action == "trash":
        if not await gate("file.trash", f"Move {src}:{file_id} to trash", "jasper", min_tier=3): raise HTTPException(403, "trash was not approved")
        return await _run(file_service.trash, src, file_id)
    if action in {"copy", "move"}:
        destination = body.get("destination")
        if not isinstance(destination, str): raise HTTPException(422, "destination is required")
        if not await gate(f"file.{action}", f"{action.title()} {src}:{file_id} to {destination}", "jasper"): raise HTTPException(403, f"{action} was not approved")
        ref = await _run(file_service.copy if action == "copy" else file_service.move, src, file_id, destination, str(body.get("name") or "")) if action == "copy" else await _run(file_service.move, src, file_id, destination)
        return ref.json()
    if action == "share":
        email, role = body.get("email"), str(body.get("role") or "reader")
        if not isinstance(email, str): raise HTTPException(422, "email is required")
        if not await gate("file.share", f"Share {src}:{file_id} with {email} as {role}", "jasper", min_tier=3): raise HTTPException(403, "sharing was not approved")
        return await _run(file_service.share, src, file_id, email, role)
    if action == "extract":
        destination = body.get("destination")
        if not isinstance(destination, str): raise HTTPException(422, "destination is required")
        if not await gate("file.extract", f"Extract {src}:{file_id} into {destination}", "jasper", min_tier=3): raise HTTPException(403, "extraction was not approved")
        return await _run(file_service.extract_archive, src, file_id, destination)
    raise HTTPException(400, "supported actions are rename, trash, copy, move, share and extract")

@router.get("/archive")
async def archive_entries(src: str, id: str):
    return {"entries": await _run(file_service.archive_entries, src, id)}

@router.put("/cells")
async def write_cells(body: dict):
    src, file_id, changes = body.get("src"), body.get("id"), body.get("changes")
    if not isinstance(src, str) or not isinstance(file_id, str) or not isinstance(changes, list): raise HTTPException(422, "src, id and changes are required")
    if not await gate("file.write", f"Update {len(changes)} cell(s) in {src}:{file_id}", "jasper"): raise HTTPException(403, "write was not approved")
    ref = await _run(file_service.write_cells, src, file_id, changes)
    from core.eventbus import bus
    bus.publish({"topic": "file-changed", "src": src, "id": file_id, "name": ref.name, "by": "jasper"})
    return ref.json()

@router.get("/{key:path}")
async def legacy_download(key: str, request: Request): return await content("attachment", key, request)
