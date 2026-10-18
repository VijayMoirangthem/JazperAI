"""Encrypted storage of OAuth tokens / session cookies per portal."""
import json
import os
import structlog
from core.services.memory_service import _pg

log = structlog.get_logger()

try:
    from cryptography.fernet import Fernet
    _FERNET_KEY = os.environ.get("FERNET_KEY", "").encode()
    if not _FERNET_KEY:
        # Generate a stable key from the Postgres password as seed (dev only)
        import base64, hashlib
        _seed = os.environ.get("POSTGRES_PASSWORD", "changeme").encode()
        _FERNET_KEY = base64.urlsafe_b64encode(hashlib.sha256(_seed).digest())
    _fernet = Fernet(_FERNET_KEY)
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False
    log.warning("cryptography package not installed — credentials stored as plaintext")


def _encrypt(data: dict) -> str:
    raw = json.dumps(data).encode()
    if CRYPTO_AVAILABLE:
        return _fernet.encrypt(raw).decode()
    return raw.decode()


def _decrypt(blob: str) -> dict:
    if CRYPTO_AVAILABLE:
        return json.loads(_fernet.decrypt(blob.encode()))
    return json.loads(blob)


def save_credential(portal: str, token_data: dict) -> None:
    encrypted = _encrypt(token_data)
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO credentials (portal, token_data)
            VALUES (%s, %s)
            ON CONFLICT (portal) DO UPDATE SET token_data = EXCLUDED.token_data, updated_at = NOW()
            """,
            (portal, json.dumps({"_enc": encrypted})),
        )
        conn.commit()
        cur.close()
        log.info("Credential saved", portal=portal)
    finally:
        conn.close()


def load_credential(portal: str) -> dict | None:
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT token_data FROM credentials WHERE portal = %s", (portal,))
        row = cur.fetchone()
        cur.close()
        if not row:
            return None
        wrapper = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        return _decrypt(wrapper["_enc"])
    except Exception as e:
        log.warning("Failed to load credential", portal=portal, error=str(e))
        return None
    finally:
        conn.close()


def delete_credential(portal: str) -> bool:
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM credentials WHERE portal = %s RETURNING portal", (portal,))
        deleted = cur.fetchone() is not None
        conn.commit()
        cur.close()
        return deleted
    finally:
        conn.close()


def list_portals() -> list[dict]:
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT portal, updated_at FROM credentials ORDER BY portal")
        rows = cur.fetchall()
        cur.close()
        return [{"portal": r[0], "updated_at": r[1].isoformat() if r[1] else None} for r in rows]
    finally:
        conn.close()
