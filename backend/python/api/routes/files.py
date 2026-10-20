"""File store API (aliased /api/v1/files): chat attachments and documents go to MinIO; only the key and sha256 are kept by callers.
Upload limit 25 MB. Names are sanitised; objects are keyed by date + random id so they cannot collide or be guessed from a name."""
import re
import time
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from core import objectstore

router = APIRouter()
MAX_BYTES = 25 * 1024 * 1024
BUCKET = "attachments"


@router.post("/")
async def upload(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "file larger than 25 MB")
    name = re.sub(r"[^A-Za-z0-9._-]", "_", file.filename or "file")[:100]
    key = f"{time.strftime('%Y/%m')}/{uuid4().hex[:12]}-{name}"
    try:
        res = objectstore.put_bytes(BUCKET, key, data, file.content_type or "application/octet-stream")
    except Exception as e:
        raise HTTPException(503, f"object store unavailable: {str(e)[:80]}")
    return {"key": key, "size": res["size"], "sha256": res["sha256"], "mime": file.content_type or "", "url": f"/api/v1/files/{key}"}


@router.get("/{key:path}")
async def download(key: str):
    if ".." in key:
        raise HTTPException(400, "bad key")
    st = objectstore.stat(BUCKET, key)
    if not st:
        raise HTTPException(404, "not found")
    return Response(objectstore.get_bytes(BUCKET, key), media_type=st.get("content_type") or "application/octet-stream", headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})
