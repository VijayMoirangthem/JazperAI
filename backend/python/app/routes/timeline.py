"""
Personality Timeline — Phase 6

POST /api/timeline/chat
  Simulates how Vijay thought, prioritised, and communicated in a given year.

  Pulls two sources of temporal context:
    1. semantic_memories where metadata->>'year' = target OR EXTRACT(YEAR FROM created_at) = target
    2. chat_messages / chat_sessions from that year (conversation snippets)

  Constructs a time-specific system prompt, then streams through the main LLM.
  Response is SSE-streamed just like the regular chat endpoint.

POST /api/timeline/tag-memory
  Tag an existing semantic_memory with an explicit year so it shows up in timeline queries.

GET /api/timeline/years
  Returns which years have at least one memory or chat session, for the year picker.
"""

from __future__ import annotations

import json
import datetime
from typing import AsyncGenerator

import structlog
from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

log = structlog.get_logger()
router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_conn():
    from app.db.init import get_connection
    return get_connection()


def _fetch_year_memories(year: int) -> list[str]:
    """Pull semantic memories explicitly tagged to a year or created in that year."""
    try:
        conn = _get_conn()
        cur  = conn.cursor()
        cur.execute("""
            SELECT content FROM semantic_memories
            WHERE
                (metadata->>'year')::int = %s
                OR EXTRACT(YEAR FROM created_at) = %s
            ORDER BY created_at
            LIMIT 40
        """, (year, year))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return [r[0] for r in rows]
    except Exception as exc:
        log.warning("Timeline: memory fetch failed", error=str(exc))
        return []


def _fetch_year_chat_snippets(year: int, limit: int = 20) -> list[str]:
    """Pull a sample of the user's messages from that year."""
    try:
        conn = _get_conn()
        cur  = conn.cursor()
        # Grab user messages from chat_messages in sessions created that year
        cur.execute("""
            SELECT m.content
            FROM chat_messages m
            JOIN chat_sessions s ON m.session_id = s.session_id
            WHERE m.role = 'user'
              AND EXTRACT(YEAR FROM s.created_at) = %s
            ORDER BY m.created_at
            LIMIT %s
        """, (year, limit))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return [r[0] for r in rows if r[0] and len(r[0].strip()) > 10]
    except Exception as exc:
        log.warning("Timeline: chat snippet fetch failed", error=str(exc))
        return []


def _build_timeline_system(year: int, memories: list[str], snippets: list[str]) -> str:
    now_year = datetime.datetime.utcnow().year
    years_ago = now_year - year

    parts = [
        f"You are simulating how Vijay Moirangthem thought, spoke, and prioritised in {year} "
        f"({years_ago} year{'s' if years_ago != 1 else ''} ago).",
        "",
        "RULES:",
        "- Respond in first person as Vijay in that year — not as an AI describing him.",
        "- Reflect the mindset, concerns, vocabulary, and priorities of that period.",
        "- If you know things changed after that year, don't mention them — you don't know yet.",
        "- Keep responses conversational and personal. No bullet lists or headers.",
        "- If you genuinely have no context for that year, say so honestly and briefly.",
        "",
    ]

    if memories:
        parts.append(f"What you (Vijay in {year}) remember about yourself and your life:")
        for m in memories:
            parts.append(f"  • {m.strip()}")
        parts.append("")

    if snippets:
        parts.append(f"Sample of how you were writing / thinking in {year}:")
        for s in snippets[:8]:
            parts.append(f'  "{s.strip()[:120]}"')
        parts.append("")

    if not memories and not snippets:
        parts.append(
            f"Note: No stored memories or conversations from {year} found. "
            f"Answer based on what is plausible for Vijay in that year from broader context."
        )

    return "\n".join(parts)


# ── Routes ────────────────────────────────────────────────────────────────────

class TimelineChatRequest(BaseModel):
    message:    str
    year:       int
    session_id: str | None = None


@router.post("/chat")
async def timeline_chat(body: TimelineChatRequest):
    """Stream a response as Vijay-in-[year]."""
    current_year = datetime.datetime.utcnow().year
    if not (1990 <= body.year <= current_year):
        raise HTTPException(400, f"year must be between 1990 and {current_year}")

    message = body.message.strip()
    if not message:
        raise HTTPException(400, "message is required")

    memories = _fetch_year_memories(body.year)
    snippets = _fetch_year_chat_snippets(body.year)
    system   = _build_timeline_system(body.year, memories, snippets)

    messages = [
        {"role": "system", "content": system},
        {"role": "user",   "content": message},
    ]

    log.info("Timeline chat", year=body.year, memories=len(memories), snippets=len(snippets))

    async def generate() -> AsyncGenerator[str, None]:
        from app.providers.ai_provider import ai_provider
        try:
            async for chunk in ai_provider.stream(
                messages=messages,
                max_tokens=512,
                temperature=0.8,     # slightly higher — personality simulation benefits from variety
                allow_local_fallback=True,
            ):
                if chunk:
                    yield f"data: {json.dumps({'content': chunk, 'year': body.year})}\n\n"
        except Exception as exc:
            log.error("Timeline stream error", error=str(exc))
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


class TagMemoryRequest(BaseModel):
    memory_id: str
    year:      int


@router.post("/tag-memory")
def tag_memory(body: TagMemoryRequest):
    """Add an explicit year tag to an existing semantic memory."""
    current_year = datetime.datetime.utcnow().year
    if not (1990 <= body.year <= current_year):
        raise HTTPException(400, f"year must be 1990–{current_year}")
    try:
        conn = _get_conn()
        cur  = conn.cursor()
        cur.execute("""
            UPDATE semantic_memories
            SET metadata = metadata || %s::jsonb
            WHERE id = %s
            RETURNING id
        """, (json.dumps({"year": body.year}), body.memory_id))
        row = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        if not row:
            raise HTTPException(404, "Memory not found")
        return {"ok": True, "id": body.memory_id, "year": body.year}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/years")
def available_years():
    """
    Returns years that have at least one memory or chat session — used to
    highlight selectable years in the frontend year picker.
    """
    current_year = datetime.datetime.utcnow().year
    years: set[int] = set()
    try:
        conn = _get_conn()
        cur  = conn.cursor()
        # Years from semantic_memories (explicit tag)
        cur.execute("""
            SELECT DISTINCT (metadata->>'year')::int
            FROM semantic_memories
            WHERE metadata ? 'year'
              AND (metadata->>'year')::int IS NOT NULL
        """)
        for (y,) in cur.fetchall():
            if y: years.add(int(y))
        # Years from semantic_memories created_at
        cur.execute("""
            SELECT DISTINCT EXTRACT(YEAR FROM created_at)::int
            FROM semantic_memories
        """)
        for (y,) in cur.fetchall():
            if y: years.add(int(y))
        # Years from chat sessions
        cur.execute("""
            SELECT DISTINCT EXTRACT(YEAR FROM created_at)::int
            FROM chat_sessions
        """)
        for (y,) in cur.fetchall():
            if y: years.add(int(y))
        cur.close()
        conn.close()
    except Exception as exc:
        log.warning("Timeline: years fetch failed", error=str(exc))

    return {
        "years":        sorted(years),
        "current_year": current_year,
        "range":        [1990, current_year],
    }
