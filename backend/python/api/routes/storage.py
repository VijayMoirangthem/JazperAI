"""Storage routes — MinIO object storage API for Create Origins OS.

Endpoints:
  GET    /api/storage/health                  — MinIO connection check
  GET    /api/storage/{prefix}                — list objects in a prefix
  POST   /api/storage/{prefix}                — upload file to prefix
  GET    /api/storage/{prefix}/{filename}     — presigned download URL
  DELETE /api/storage/{prefix}/{filename}     — delete object
  GET    /api/storage/presign-upload/{prefix}/{filename} — presigned PUT URL for direct upload

Valid prefixes: agent-avatars, documents, memories, artifacts, sessions, voice-cache, uploads
"""

from __future__ import annotations

import mimetypes

import structlog
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import Response

from core.services.storage import VALID_PREFIXES, storage

log = structlog.get_logger()
router = APIRouter()


def _guard_prefix(prefix: str):
    if prefix not in VALID_PREFIXES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid prefix '{prefix}'. Valid: {sorted(VALID_PREFIXES)}",
        )


# ── GET /health ───────────────────────────────────────────────────────────────

@router.get("/health")
def storage_health():
    return storage.health()


# ── GET /{prefix} — list ──────────────────────────────────────────────────────

@router.get("/{prefix}")
def list_objects(prefix: str):
    _guard_prefix(prefix)
    try:
        objects = storage.list_objects(prefix)
        return {
            "prefix": prefix,
            "count": len(objects),
            "objects": objects,
        }
    except Exception as e:
        log.error("storage_list_failed", prefix=prefix, error=str(e))
        raise HTTPException(status_code=503, detail=f"Storage unavailable: {e}")


# ── POST /{prefix} — upload ───────────────────────────────────────────────────

@router.post("/{prefix}")
async def upload_file(prefix: str, file: UploadFile = File(...)):
    _guard_prefix(prefix)
    try:
        data = await file.read()
        content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
        object_name = storage.upload(prefix, file.filename or "unnamed", data, content_type)
        url = storage.presigned_url(prefix, file.filename or "unnamed")
        return {
            "object": object_name,
            "filename": file.filename,
            "size": len(data),
            "content_type": content_type,
            "url": url,
        }
    except Exception as e:
        log.error("storage_upload_failed", prefix=prefix, filename=file.filename, error=str(e))
        raise HTTPException(status_code=503, detail=f"Upload failed: {e}")


# ── GET /presign-upload/{prefix}/{filename} — presigned PUT URL ───────────────

@router.get("/presign-upload/{prefix}/{filename}")
def presign_upload(prefix: str, filename: str, expires: int = Query(900, ge=60, le=86400)):
    _guard_prefix(prefix)
    try:
        url = storage.presigned_upload_url(prefix, filename, expires_seconds=expires)
        return {"url": url, "prefix": prefix, "filename": filename, "expires_in": expires}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Storage unavailable: {e}")


# ── GET /{prefix}/{filename} — presigned download URL ─────────────────────────

@router.get("/{prefix}/{filename}")
def get_download_url(
    prefix: str,
    filename: str,
    expires: int = Query(3600, ge=60, le=86400),
    inline: bool = Query(False, description="Return file inline instead of redirect URL"),
):
    _guard_prefix(prefix)
    try:
        if inline:
            data = storage.download(prefix, filename)
            ct = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            return Response(content=data, media_type=ct)
        url = storage.presigned_url(prefix, filename, expires_seconds=expires)
        return {"url": url, "expires_in": expires, "prefix": prefix, "filename": filename}
    except Exception as e:
        log.error("storage_download_failed", prefix=prefix, filename=filename, error=str(e))
        raise HTTPException(status_code=503, detail=f"Download failed: {e}")


# ── DELETE /{prefix}/{filename} ───────────────────────────────────────────────

@router.delete("/{prefix}/{filename}")
def delete_object(prefix: str, filename: str):
    _guard_prefix(prefix)
    try:
        ok = storage.delete(prefix, filename)
        if not ok:
            raise HTTPException(status_code=404, detail="Object not found or delete failed")
        return {"deleted": True, "object": f"{prefix}/{filename}"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Delete failed: {e}")
