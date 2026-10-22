"""In-app Drive viewer API: list/search files, metadata, and file bytes (with HTTP Range so audio and video can seek)."""
import asyncio
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from core.services import drive_service as ds

router = APIRouter()


async def _run(fn, *a):
    try:
        return await asyncio.to_thread(fn, *a)
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@router.get("/files")
async def files(q: str = "", limit: int = 30):
    return {"files": await _run(ds.search, q, limit) if q.strip() else await _run(ds.list_recent, limit)}


@router.get("/{file_id}/meta")
async def meta(file_id: str):
    return await _run(ds.get_file, file_id)


@router.get("/{file_id}/view")
async def view(file_id: str, request: Request, mode: str = "auto"):
    path, ctype, m = await _run(ds.view_file, file_id, mode)
    size = path.stat().st_size
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=60", "X-File-Name": re.sub(r"[^\x20-\x7e]", "_", m.get("name", ""))}
    rng = request.headers.get("range")
    if rng and (mt := re.match(r"bytes=(\d*)-(\d*)", rng)):
        start = int(mt.group(1) or 0)
        end = min(int(mt.group(2)) if mt.group(2) else size - 1, size - 1)
        if start > end:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        with open(path, "rb") as fh:
            fh.seek(start)
            data = fh.read(end - start + 1)
        return Response(data, 206, {**headers, "Content-Range": f"bytes {start}-{end}/{size}"}, media_type=ctype)
    return Response(path.read_bytes(), 200, headers, media_type=ctype)
