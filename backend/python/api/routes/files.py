"""Unified source-agnostic file API; the legacy upload URL remains supported."""
from __future__ import annotations

import asyncio
import re
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
    start = int(match.group(1) or 0); end = min(int(match.group(2)) if match.group(2) else size - 1, size - 1)
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

@router.get("")
async def list_files(src: str = "drive", q: str = "", path: str = "", limit: int = 100):
    rows = await _run(file_service.list, src, q, path, max(1, min(limit, 200)))
    return {"files": [r.json() for r in rows]}

@router.get("/meta")
async def meta(src: str, id: str): return (await _run(file_service.meta, src, id)).json()

@router.get("/content")
async def content(src: str, id: str, request: Request, mode: str = "raw"):
    if mode not in {"raw", "text", "html", "pdf", "thumb"}: raise HTTPException(400, "unknown content mode")
    path, mime, ref = await _run(file_service.open_path, src, id, mode)
    return _range(path, request, mime, ref.name)

@router.post("/upload")
@router.post("/")
async def upload(file: UploadFile = File(...)):
    data = await file.read(MAX_BYTES + 1)
    ref = await _run(file_service.save_attachment, file.filename or "file", data, file.content_type or "")
    value = ref.json(); value.update({"key": ref.id, "url": f"/api/v1/files/content?src=attachment&id={ref.id}"})
    return value

@router.put("/content")
async def write_content(body: dict):
    src, file_id, text = body.get("src"), body.get("id"), body.get("text")
    if not all(isinstance(x, str) for x in (src, file_id, text)): raise HTTPException(422, "src, id and text are required")
    if not await gate("file.write", f"Write {len(text)} chars to {src}:{file_id}", "jasper"): raise HTTPException(403, "write was not approved")
    return (await _run(file_service.write_text, src, file_id, text)).json()

@router.get("/{key:path}")
async def legacy_download(key: str, request: Request): return await content("attachment", key, request)
