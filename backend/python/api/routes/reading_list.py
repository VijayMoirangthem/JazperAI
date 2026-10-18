"""Phase 23 — Reading List with AI Summaries."""
from __future__ import annotations

from typing import Optional
from urllib.parse import urlparse

import psycopg2.extras
import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.providers.ai_provider import get_ai_provider
from core.services.knowledge_service import ingest
from core.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


# ── Pydantic models ────────────────────────────────────────────────────────────

class ReadingListCreate(BaseModel):
    url: str
    title: str = ""
    tags: list[str] = []


class ReadingListUpdate(BaseModel):
    status: Optional[str] = None
    title: Optional[str] = None
    tags: Optional[list[str]] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _title_from_url(url: str) -> str:
    """Derive a readable fallback title from a URL."""
    try:
        parsed = urlparse(url)
        host = parsed.hostname or url
        path_parts = [p for p in parsed.path.strip("/").split("/") if p]
        if path_parts:
            slug = path_parts[-1].replace("-", " ").replace("_", " ").title()
            return f"{host} — {slug}"
        return host
    except Exception:
        return url


def _fmt(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "url": r["url"],
        "title": r["title"],
        "summary": r.get("summary") or "",
        "tags": r.get("tags") or [],
        "status": r["status"],
        "added_at": r["added_at"].isoformat() if r.get("added_at") else None,
    }


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("")
async def add_reading_item(body: ReadingListCreate):
    """Add a URL with an AI-generated summary; also ingest into knowledge base."""
    title = body.title.strip() if body.title.strip() else _title_from_url(body.url)

    # Generate a quick summary from URL + title (no web fetch)
    summary = ""
    try:
        provider = get_ai_provider()
        result = await provider.chat(
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Given this URL and title, write a 1-2 sentence summary of what this "
                        f"article is likely about. URL: {body.url} Title: {title}"
                    ),
                }
            ],
            model="llama-3.1-8b-instant",
            max_tokens=200,
            temperature=0.3,
        )
        summary = result.content.strip()
    except Exception as e:
        log.warning("reading_list: LLM summary failed (non-fatal)", error=str(e))

    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO reading_list (url, title, summary, tags)
                    VALUES (%s, %s, %s, %s)
                    RETURNING *
                    """,
                    (body.url, title, summary, body.tags),
                )
                row = dict(cur.fetchone())
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))

    # Ingest into knowledge base for RAG
    try:
        ingest(
            title=title,
            content=f"{title}\n\n{summary}",
            source_type="reading_list",
            source_url=body.url,
        )
    except Exception as e:
        log.warning("reading_list: knowledge ingest failed (non-fatal)", error=str(e))

    return _fmt(row)


@router.get("")
def list_reading(status: str = "unread"):
    """List reading list items. Pass status=all for every entry."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if status == "all":
                    cur.execute("SELECT * FROM reading_list ORDER BY added_at DESC")
                else:
                    cur.execute(
                        "SELECT * FROM reading_list WHERE status = %s ORDER BY added_at DESC",
                        (status,),
                    )
                rows = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(500, str(e))

    return {"items": [_fmt(r) for r in rows]}


@router.patch("/{item_id}")
def update_reading_item(item_id: str, body: ReadingListUpdate):
    """Update status, title, or tags of a reading list entry."""
    updates: dict = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    set_parts = [f"{k} = %s" for k in updates]
    values = list(updates.values()) + [item_id]

    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    f"UPDATE reading_list SET {', '.join(set_parts)} "
                    f"WHERE id = %s::uuid RETURNING *",
                    values,
                )
                row = cur.fetchone()
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))

    if not row:
        raise HTTPException(404, "Reading list item not found")
    return _fmt(dict(row))


@router.delete("/{item_id}")
def delete_reading_item(item_id: str):
    """Delete a reading list entry and its corresponding knowledge item."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT url FROM reading_list WHERE id = %s::uuid", (item_id,)
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(404, "Reading list item not found")
                url = row["url"]
                cur.execute("DELETE FROM reading_list WHERE id = %s::uuid", (item_id,))
                cur.execute(
                    "DELETE FROM knowledge_items WHERE source_url = %s", (url,)
                )
            conn.commit()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))

    return {"ok": True, "deleted_id": item_id}
