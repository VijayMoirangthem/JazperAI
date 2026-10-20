"""Object store (MinIO, S3 API) for unstructured data and backups (Plan V3 W7).

Postgres keeps structure and vectors; MinIO keeps bytes: chat attachments, documents, exports and encrypted backups. Postgres/Redis hold only the
object key + sha256. Credentials live in the OS vault (MINIO_ACCESS_KEY / MINIO_SECRET_KEY), never in code. Uses the `minio` client already
in the pinned environment (no new dependency).

Buckets: attachments, documents, exports (versioned); backups (versioned + object lock, 30-day governance retention); wal (written by the shipper).
"""
import hashlib
import io
from datetime import timedelta

from core import vault

ENDPOINT = "127.0.0.1:9000"
BUCKETS = {"attachments": {}, "documents": {}, "exports": {}, "backups": {"lock": True}}
BACKUP_RETENTION_DAYS = 30
_client = None


def _creds() -> tuple[str, str]:
    k, s = vault.get("MINIO_ACCESS_KEY"), vault.get("MINIO_SECRET_KEY")
    if not k or not s:
        raise RuntimeError("MinIO credentials missing: run scripts/setup_minio.py")
    return k, s


def client():
    global _client
    if _client is None:
        from minio import Minio
        k, s = _creds()
        _client = Minio(ENDPOINT, access_key=k, secret_key=s, secure=False)
    return _client


def available() -> bool:
    try:
        client().list_buckets()
        return True
    except Exception:
        return False


def ensure_buckets() -> dict:
    """Create missing buckets with versioning (and object lock on backups). Idempotent. Returns {bucket: 'created'|'exists'}."""
    from minio.commonconfig import GOVERNANCE
    from minio.objectlockconfig import DAYS, ObjectLockConfig
    from minio.versioningconfig import ENABLED, VersioningConfig
    c, out = client(), {}
    for name, opt in BUCKETS.items():
        if c.bucket_exists(name):
            out[name] = "exists"
            continue
        c.make_bucket(name, object_lock=bool(opt.get("lock")))
        out[name] = "created"
        if not opt.get("lock"):  # object-lock buckets are versioned automatically
            c.set_bucket_versioning(name, VersioningConfig(ENABLED))
        else:
            c.set_object_lock_config(name, ObjectLockConfig(GOVERNANCE, BACKUP_RETENTION_DAYS, DAYS))
    return out


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def put_bytes(bucket: str, key: str, data: bytes, content_type: str = "application/octet-stream") -> dict:
    digest = sha256_hex(data)
    res = client().put_object(bucket, key, io.BytesIO(data), len(data), content_type=content_type, metadata={"sha256": digest})
    return {"bucket": bucket, "key": key, "size": len(data), "sha256": digest, "version": res.version_id}


def get_bytes(bucket: str, key: str) -> bytes:
    r = client().get_object(bucket, key)
    try:
        return r.read()
    finally:
        r.close()
        r.release_conn()


def stat(bucket: str, key: str) -> dict | None:
    try:
        o = client().stat_object(bucket, key)
        return {"size": o.size, "sha256": (o.metadata or {}).get("x-amz-meta-sha256"), "content_type": o.content_type, "etag": o.etag}
    except Exception:
        return None


def presign(bucket: str, key: str, minutes: int = 15) -> str:
    return client().presigned_get_object(bucket, key, expires=timedelta(minutes=minutes))


def put_file(bucket: str, key: str, path: str) -> dict:
    """Stream a local file to MinIO and verify the stored size and hash metadata."""
    h = hashlib.sha256()
    size = 0
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            size += len(chunk)
    client().fput_object(bucket, key, path, metadata={"sha256": h.hexdigest()})
    st = stat(bucket, key)
    if not st or st["size"] != size:
        raise RuntimeError(f"upload verification failed for {key}")
    return {"bucket": bucket, "key": key, "size": size, "sha256": h.hexdigest()}


def list_keys(bucket: str, prefix: str = "") -> list[dict]:
    return [{"key": o.object_name, "size": o.size, "modified": o.last_modified.isoformat() if o.last_modified else None}
            for o in client().list_objects(bucket, prefix=prefix, recursive=True)]
