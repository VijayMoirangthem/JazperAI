from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import psycopg2
import psycopg2.extras
from core.config import settings

router = APIRouter()


def _pg():
    return psycopg2.connect(
        host=settings.POSTGRES_HOST, port=settings.POSTGRES_PORT,
        user=settings.POSTGRES_USER, password=settings.POSTGRES_PASSWORD,
        dbname=settings.POSTGRES_DB,
    )


# ── Models ────────────────────────────────────────────────────────────────────

class CoreMemoryCreate(BaseModel):
    content: str

class CoreMemoryUpdate(BaseModel):
    content: str

class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


class TopicCreate(BaseModel):
    topic: str
    query: str | None = None


# ── Scout topic monitoring ────────────────────────────────────────────────────

@router.get("/topics")
def list_watched_topics():
    from agents.workers.scout_monitor_worker import list_topics
    return {"topics": list_topics()}


@router.post("/topics")
def add_watched_topic(body: TopicCreate):
    from agents.workers.scout_monitor_worker import add_topic
    return add_topic(body.topic, body.query)


@router.delete("/topics/{topic}")
def remove_watched_topic(topic: str):
    from agents.workers.scout_monitor_worker import remove_topic
    return remove_topic(topic)


# ── Core memories ─────────────────────────────────────────────────────────────

@router.get("/core")
def list_core():
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, content, created_at, updated_at FROM core_memories ORDER BY created_at DESC")
            return {"memories": [dict(r) for r in cur.fetchall()]}


@router.post("/core", status_code=201)
def create_core(body: CoreMemoryCreate):
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "INSERT INTO core_memories (content) VALUES (%s) RETURNING id, content, created_at, updated_at",
                (body.content.strip(),),
            )
            row = dict(cur.fetchone())
        conn.commit()
    return row


@router.put("/core/{memory_id}")
def update_core(memory_id: str, body: CoreMemoryUpdate):
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "UPDATE core_memories SET content=%s, updated_at=NOW() WHERE id=%s RETURNING id, content, updated_at",
                (body.content.strip(), memory_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Not found")
        conn.commit()
    return dict(row)


@router.delete("/core/{memory_id}", status_code=204)
def delete_core(memory_id: str):
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM core_memories WHERE id=%s", (memory_id,))
        conn.commit()


# ── Extracted memories ────────────────────────────────────────────────────────

@router.get("/extracted")
def list_extracted():
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT id, content, session_id, created_at FROM extracted_memories ORDER BY created_at DESC")
            return {"memories": [dict(r) for r in cur.fetchall()]}


@router.delete("/extracted/{memory_id}", status_code=204)
def delete_extracted(memory_id: str):
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM extracted_memories WHERE id=%s", (memory_id,))
        conn.commit()


@router.delete("/extracted", status_code=204)
def clear_extracted():
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM extracted_memories")
        conn.commit()


# ── Auto memories (pgvector) ──────────────────────────────────────────────────

@router.get("/auto")
def list_auto(limit: int = 50, offset: int = 0):
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, content, metadata, created_at FROM memories ORDER BY created_at DESC LIMIT %s OFFSET %s",
                (limit, offset),
            )
            rows = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT COUNT(*) as count FROM memories")
            total = cur.fetchone()["count"]
    return {"memories": rows, "total": total}


@router.delete("/auto/{memory_id}", status_code=204)
def delete_auto(memory_id: str):
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM memories WHERE id=%s", (memory_id,))
        conn.commit()


@router.delete("/auto", status_code=204)
def clear_auto():
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM memories")
        conn.commit()


# ── Nuclear clear options ─────────────────────────────────────────────────────

@router.delete("/clear-memories", status_code=204)
def clear_all_memories():
    """Wipe core + extracted + auto memories. Keeps chat history."""
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM core_memories")
            cur.execute("DELETE FROM extracted_memories")
            cur.execute("DELETE FROM memories")
        conn.commit()


@router.delete("/clear-everything", status_code=204)
def clear_everything():
    """Wipe all memories AND all chat history."""
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM core_memories")
            cur.execute("DELETE FROM extracted_memories")
            cur.execute("DELETE FROM memories")
            cur.execute("DELETE FROM chat_sessions")  # cascades to chat_messages
        conn.commit()


# ── Sage memory viewer ───────────────────────────────────────────────────────

@router.get("/sage")
def get_sage_memory(limit: int = 50):
    """Return Sage-consolidated memory entries from knowledge_items."""
    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT id, title, content, source_type AS source, created_at, tags
                FROM knowledge_items
                WHERE source_type = 'sage_consolidation'
                   OR 'sage' = ANY(tags)
                   OR source_type ILIKE '%%sage%%'
                ORDER BY created_at DESC
                LIMIT %s
            """, (limit,))
            rows = cur.fetchall()
            cur.execute("""
                SELECT COUNT(*)
                FROM knowledge_items
                WHERE source_type = 'sage_consolidation'
                   OR 'sage' = ANY(tags)
                   OR source_type ILIKE '%%sage%%'
            """)
            total = cur.fetchone()["count"]

    entries = []
    for r in rows:
        row = dict(r)
        row["id"] = str(row["id"])
        if row.get("created_at"):
            row["created_at"] = row["created_at"].isoformat()
        entries.append(row)

    return {"entries": entries, "total": total}


# ── Semantic search ───────────────────────────────────────────────────────────

@router.post("/search")
def semantic_search(body: SearchRequest):
    from core.providers.ai_provider import ai_provider
    try:
        embedding = ai_provider.embed_sync(body.query)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Embedding failed: {e}")

    vec = "[" + ",".join(str(x) for x in embedding) + "]"

    with _pg() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, content, metadata, created_at,
                       ROUND(CAST(1 - (embedding <=> %s::vector) AS numeric), 3) AS score
                FROM memories
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                (vec, vec, body.top_k),
            )
            results = [dict(r) for r in cur.fetchall()]

    return {"results": results}
