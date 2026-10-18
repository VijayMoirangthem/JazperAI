"""
Phase 11B — Personal Knowledge Base.

Users can add documents (paste, URL, file). Items are embedded
and retrieved via vector similarity at chat time.
"""
from __future__ import annotations
import re
import structlog
from memory.db.legacy_pg import _pg
from core.services.embedding_service import embed

log = structlog.get_logger()

_CHUNK_SIZE = 1500   # chars per chunk (overlapping)
_CHUNK_OVERLAP = 200


def _chunk_text(text: str) -> list[str]:
    """Split long text into overlapping chunks."""
    if len(text) <= _CHUNK_SIZE:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = start + _CHUNK_SIZE
        chunks.append(text[start:end])
        start += _CHUNK_SIZE - _CHUNK_OVERLAP
    return chunks


def ingest(title: str, content: str, source_type: str = "paste",
           source_url: str | None = None, source_file: str | None = None,
           tags: list[str] | None = None) -> dict:
    """Store a knowledge item with its embedding."""
    content = content.strip()
    if not content:
        raise ValueError("Content is empty")

    vec = embed(content[:2000])  # embed first 2000 chars for the item
    tags = tags or []
    char_count = len(content)

    with _pg() as conn:
        with conn.cursor() as cur:
            if vec:
                cur.execute("""
                    INSERT INTO knowledge_items
                        (title, content, source_type, source_url, source_file,
                         tags, embedding, char_count)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::vector, %s)
                    RETURNING id
                """, (title, content, source_type, source_url, source_file,
                      tags, str(vec), char_count))
            else:
                cur.execute("""
                    INSERT INTO knowledge_items
                        (title, content, source_type, source_url, source_file,
                         tags, char_count)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (title, content, source_type, source_url, source_file,
                      tags, char_count))
            item_id = cur.fetchone()[0]
        conn.commit()

    log.info("Knowledge item ingested", id=str(item_id), title=title, chars=char_count)
    return {"id": str(item_id), "title": title, "chars": char_count}


def ingest_url(url: str) -> dict:
    """Fetch a URL and ingest its text content."""
    import requests
    from urllib.parse import urlparse

    try:
        resp = requests.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        raw = resp.text

        # Strip HTML tags
        clean = re.sub(r"<[^>]+>", " ", raw)
        clean = re.sub(r"\s+", " ", clean).strip()

        if len(clean) < 50:
            raise ValueError("Could not extract meaningful text from URL")

        parsed = urlparse(url)
        title = parsed.netloc + parsed.path
        return ingest(title=title, content=clean[:50_000], source_type="url", source_url=url)
    except Exception as e:
        log.warning("ingest_url failed", url=url, error=str(e))
        raise


def search(query: str, top_k: int = 3) -> list[dict]:
    """Find most relevant knowledge items for a query."""
    vec = embed(query)
    if vec is None:
        # Fallback: keyword search
        return _keyword_search(query, top_k)

    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, title, content, source_type, source_url, created_at,
                           1 - (embedding <=> %s::vector) AS score
                    FROM knowledge_items
                    WHERE embedding IS NOT NULL
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                """, (str(vec), str(vec), top_k))
                cols = [d[0] for d in cur.description]
                rows = cur.fetchall()
        results = []
        for r in rows:
            row = dict(zip(cols, r))
            row["id"] = str(row["id"])
            row["score"] = float(row["score"])
            row["snippet"] = row["content"][:300]
            # keep created_at as datetime object so callers can apply recency scoring
            results.append(row)
        return results
    except Exception as e:
        log.warning("knowledge search failed", error=str(e))
        return []


def _keyword_search(query: str, top_k: int) -> list[dict]:
    words = [w.lower() for w in query.split() if len(w) > 3]
    if not words:
        return []
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, title, content, source_type, source_url
                    FROM knowledge_items
                    WHERE LOWER(content) LIKE %s OR LOWER(title) LIKE %s
                    LIMIT %s
                """, (f"%{words[0]}%", f"%{words[0]}%", top_k))
                cols = [d[0] for d in cur.description]
                rows = cur.fetchall()
        return [dict(zip(cols, r)) for r in rows]
    except Exception:
        return []


def get_all(limit: int = 50) -> list[dict]:
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, title, source_type, source_url, source_file,
                           tags, char_count, created_at
                    FROM knowledge_items ORDER BY created_at DESC LIMIT %s
                """, (limit,))
                cols = [d[0] for d in cur.description]
                rows = cur.fetchall()
        result = []
        for r in rows:
            row = dict(zip(cols, r))
            row["id"] = str(row["id"])
            row["created_at"] = row["created_at"].isoformat() if row["created_at"] else None
            result.append(row)
        return result
    except Exception as e:
        log.warning("get_all knowledge failed", error=str(e))
        return []


def delete_item(item_id: str) -> None:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM knowledge_items WHERE id = %s", (item_id,))
        conn.commit()
