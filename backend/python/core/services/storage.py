"""MinIO object-storage client for Create Origins OS.

Bucket layout (all inside the single `sirjazper` bucket):
  agent-avatars/   — custom agent avatar images (migrated from local uploads/)
  documents/       — user-uploaded PDFs, research docs, attachments
  memories/        — exported memory snapshots
  artifacts/       — agent output files (code, reports, generated content)
  sessions/        — exported chat session transcripts
  voice-cache/     — TTS audio cache files
  uploads/         — general user uploads

Usage:
    from core.services.storage import storage
    storage.upload("documents", "report.pdf", pdf_bytes, "application/pdf")
    url = storage.presigned_url("documents", "report.pdf")
"""

from __future__ import annotations

import io
from datetime import timedelta
from pathlib import Path
from typing import Optional

import structlog

log = structlog.get_logger()

VALID_PREFIXES = frozenset({
    "agent-avatars",
    "documents",
    "memories",
    "artifacts",
    "sessions",
    "voice-cache",
    "uploads",
})


class _StorageClient:
    """Lazy MinIO client — connects on first use, fails gracefully if offline."""

    def __init__(self):
        self._client = None
        self._bucket: Optional[str] = None

    def _init(self):
        if self._client is not None:
            return
        from minio import Minio
        from core.config import settings as s
        self._bucket = s.MINIO_BUCKET
        self._client = Minio(
            f"{s.MINIO_HOST}:{s.MINIO_PORT}",
            access_key=s.MINIO_ROOT_USER,
            secret_key=s.MINIO_ROOT_PASSWORD,
            secure=False,
        )

    @property
    def client(self):
        self._init()
        return self._client

    @property
    def bucket(self) -> str:
        self._init()
        return self._bucket  # type: ignore[return-value]

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def ensure_bucket(self):
        """Create the bucket if it doesn't exist. Called on startup."""
        try:
            self._init()
            if not self.client.bucket_exists(self.bucket):
                self.client.make_bucket(self.bucket)
                log.info("MinIO bucket created", bucket=self.bucket)
            else:
                log.info("MinIO bucket ready", bucket=self.bucket)
        except Exception as e:
            log.warning("MinIO not available — object storage disabled", error=str(e))

    def health(self) -> dict:
        """Return connection status and bucket info."""
        try:
            self._init()
            exists = self.client.bucket_exists(self.bucket)
            return {"status": "ok", "bucket": self.bucket, "exists": exists}
        except Exception as e:
            return {"status": "offline", "error": str(e)}

    # ── Object operations ─────────────────────────────────────────────────────

    def upload(
        self,
        prefix: str,
        filename: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        """Upload bytes and return the full object name (prefix/filename)."""
        object_name = f"{prefix}/{filename}"
        self.client.put_object(
            self.bucket,
            object_name,
            io.BytesIO(data),
            length=len(data),
            content_type=content_type,
        )
        log.info("MinIO upload", object=object_name, size=len(data))
        return object_name

    def upload_file(self, prefix: str, file_path: str | Path, content_type: str = "application/octet-stream") -> str:
        """Upload from a local file path."""
        path = Path(file_path)
        data = path.read_bytes()
        return self.upload(prefix, path.name, data, content_type)

    def download(self, prefix: str, filename: str) -> bytes:
        """Download object and return raw bytes."""
        response = self.client.get_object(self.bucket, f"{prefix}/{filename}")
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()

    def delete(self, prefix: str, filename: str) -> bool:
        """Delete an object. Returns True on success."""
        try:
            self.client.remove_object(self.bucket, f"{prefix}/{filename}")
            return True
        except Exception as e:
            log.warning("MinIO delete failed", object=f"{prefix}/{filename}", error=str(e))
            return False

    def list_objects(self, prefix: str) -> list[dict]:
        """List all objects under a prefix."""
        objects = self.client.list_objects(
            self.bucket, prefix=f"{prefix}/", recursive=True
        )
        result = []
        for obj in objects:
            result.append({
                "name": obj.object_name,
                "filename": obj.object_name.split("/", 1)[-1],
                "size": obj.size,
                "last_modified": obj.last_modified.isoformat() if obj.last_modified else None,
                "content_type": obj.content_type,
            })
        return result

    def presigned_url(self, prefix: str, filename: str, expires_seconds: int = 3600) -> str:
        """Return a presigned GET URL valid for `expires_seconds`."""
        return self.client.presigned_get_object(
            self.bucket,
            f"{prefix}/{filename}",
            expires=timedelta(seconds=expires_seconds),
        )

    def presigned_upload_url(self, prefix: str, filename: str, expires_seconds: int = 900) -> str:
        """Return a presigned PUT URL so the frontend can upload directly."""
        return self.client.presigned_put_object(
            self.bucket,
            f"{prefix}/{filename}",
            expires=timedelta(seconds=expires_seconds),
        )

    def direct_url(self, prefix: str, filename: str) -> str:
        """Internal direct URL (no auth — only use inside the private network)."""
        from core.config import settings as s
        return f"http://{s.MINIO_HOST}:{s.MINIO_PORT}/{self.bucket}/{prefix}/{filename}"

    def object_exists(self, prefix: str, filename: str) -> bool:
        """Check if an object exists without downloading it."""
        try:
            self.client.stat_object(self.bucket, f"{prefix}/{filename}")
            return True
        except Exception:
            return False


# ── Singleton ─────────────────────────────────────────────────────────────────
storage = _StorageClient()
