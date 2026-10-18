"""Encrypted storage of OAuth tokens / session cookies per portal. Keys live in the OS vault (core.vault)."""
import json

import structlog

from core import vault
from memory.db.legacy_pg import _pg

log = structlog.get_logger()


def _encrypt(data: dict) -> str:
    return vault.encrypt(data)


def _decrypt(blob: str) -> dict:
    return vault.decrypt(blob)


def save_credential(portal: str, token_data: dict) -> None:
    encrypted = _encrypt(token_data)
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO credentials (portal, token_data)
                VALUES (%s, %s)
                ON CONFLICT (portal) DO UPDATE SET token_data = EXCLUDED.token_data, updated_at = NOW()
                """,
                (portal, json.dumps({"_enc": encrypted})),
            )
        conn.commit()
    log.info("Credential saved", portal=portal)


def load_credential(portal: str) -> dict | None:
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT token_data FROM credentials WHERE portal = %s", (portal,))
                row = cur.fetchone()
        if not row:
            return None
        wrapper = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        return _decrypt(wrapper["_enc"])
    except Exception as e:
        log.warning("Failed to load credential", portal=portal, error=type(e).__name__)
        return None


def delete_credential(portal: str) -> bool:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM credentials WHERE portal = %s RETURNING portal", (portal,))
            deleted = cur.fetchone() is not None
        conn.commit()
    return deleted


def list_portals() -> list[dict]:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT portal, updated_at FROM credentials ORDER BY portal")
            rows = cur.fetchall()
    return [{"portal": r[0], "updated_at": r[1].isoformat() if r[1] else None} for r in rows]
