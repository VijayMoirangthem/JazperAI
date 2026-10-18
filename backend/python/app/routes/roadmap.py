"""
Roadmap panel backend.

Endpoints:
  GET  /api/roadmap/stats    — live platform numbers from DB + registry
  GET  /api/roadmap/context  — assembled platform knowledge for mini-chat system prompt
  POST /api/roadmap/chat     — streaming mini-chat with platform context injected
  POST /api/roadmap/notes    — save a roadmap conversation note
  GET  /api/roadmap/notes    — list saved notes
  DELETE /api/roadmap/notes/{id} — delete a note
"""

import json
import uuid
import datetime
import structlog
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()
log = structlog.get_logger()


# ── Live stats ────────────────────────────────────────────────────────────────

@router.get("/stats")
async def roadmap_stats():
    """Live platform counts — DB queries + registry inspection."""
    stats = {
        "agents": 6,
        "panels": 15,          # sidebar panels including Roadmap
        "api_routes": 22,
        "workers": 7,
        "personalities": 5,
        "tests": 20,
        "chat_sessions": 0,
        "memories_total": 0,
        "job_applications": 0,
        "cron_jobs": 0,
        "unresolved_errors": 0,
    }

    try:
        import psycopg2
        from app.core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()

        # Chat sessions
        cur.execute("SELECT COUNT(*) FROM chat_sessions")
        stats["chat_sessions"] = cur.fetchone()[0]

        # Total memories across all tiers
        cur.execute("""
            SELECT (
                (SELECT COUNT(*) FROM core_memories) +
                (SELECT COUNT(*) FROM extracted_memories) +
                (SELECT COUNT(*) FROM semantic_memories)
            )
        """)
        stats["memories_total"] = cur.fetchone()[0]

        # Job applications
        cur.execute("SELECT COUNT(*) FROM job_applications")
        stats["job_applications"] = cur.fetchone()[0]

        # Cron jobs
        cur.execute("SELECT COUNT(*) FROM cron_jobs WHERE enabled = TRUE")
        stats["cron_jobs"] = cur.fetchone()[0]

        # Unresolved agent errors
        cur.execute("SELECT COUNT(*) FROM agent_errors WHERE resolved = FALSE")
        stats["unresolved_errors"] = cur.fetchone()[0]

        cur.close()
        conn.close()
    except Exception as e:
        log.warning("roadmap_stats: DB query failed", error=str(e))

    return stats


# ── Platform context for mini-chat ───────────────────────────────────────────

@router.get("/context")
async def roadmap_context():
    """
    Assemble full platform knowledge for the Roadmap mini-chat system prompt.
    Includes: agents from registry, feature list, phases, live stats, recent errors.
    """
    from app.agents.registry import agent_registry
    agent_registry._ensure_loaded()

    agents = [
        {
            "name": a.name,
            "emoji": a.emoji,
            "description": a.description,
            "model": a.model,
        }
        for a in agent_registry.all()
    ]

    phases = [
        {"id": "p1",  "name": "Phase 1 — Foundation",             "status": "done"},
        {"id": "p2",  "name": "Phase 2 — Full Agent Roster",       "status": "done"},
        {"id": "p3",  "name": "Phase 3 — Background Intelligence", "status": "done"},
        {"id": "p35", "name": "Phase 3.5 — UI + Features",         "status": "done"},
        {"id": "p4",  "name": "Phase 4 — Infrastructure & Cleanup","status": "done"},
        {"id": "ob",  "name": "Option B — Phase 5 Prerequisites",  "status": "done"},
        {"id": "oa",  "name": "Option A — Advanced Orchestration", "status": "next"},
        {"id": "oc",  "name": "Option C — IT Department (Self-Repair + Self-Create)", "status": "upcoming"},
        {"id": "od",  "name": "Option D — Phases Advanced",        "status": "upcoming"},
    ]

    features = [
        {"name": "Streaming Chat + Memory",    "agents": ["Sage","Scout","Hermes"], "status": "live",    "description": "Real-time AI chat with 4-tier persistent memory (Redis + PostgreSQL + pgvector)."},
        {"name": "Multi-Agent Orchestration",  "agents": ["Scout","Hermes","Sage","Lens","Atlas","Phantom"], "status": "live", "description": "6 specialist agents running in parallel, keyword-routed by Jazper."},
        {"name": "Gmail Integration",          "agents": ["Hermes"],                "status": "live",    "description": "10 Gmail tools via OAuth 2.0 — read, send, reply, archive, search, label."},
        {"name": "LinkedIn Job Apply",         "agents": ["Atlas"],                 "status": "live",    "description": "Playwright browser automation — finds Easy Apply jobs, fills forms, tracks applications."},
        {"name": "Web Search Fallback Chain",  "agents": ["Scout"],                 "status": "live",    "description": "Tavily → Brave → DuckDuckGo → Wikipedia. Real-time information grounding."},
        {"name": "Voice (STT + TTS)",          "agents": [],                        "status": "live",    "description": "Faster-Whisper speech-to-text, Edge-TTS neural voices. Sentence-level TTS queuing."},
        {"name": "Phases — Digital Mind Sim.", "agents": [],                        "status": "live",    "description": "5 AI versions of you (Past/Current/Future/Logical/Emotional Self) debate decisions."},
        {"name": "Background Workers",         "agents": ["Hermes","Atlas","Scout","Sage"], "status": "live", "description": "7 APScheduler workers: inbox monitor, job digest, topic monitor, memory dedup."},
        {"name": "Observatory",                "agents": ["all"],                   "status": "live",    "description": "Live agent activity feed, session viewer, per-agent stats."},
        {"name": "Memory System",              "agents": ["Sage"],                  "status": "live",    "description": "4 tiers: Redis (session), core facts, extracted facts, semantic search via pgvector."},
        {"name": "Pytest Test Suite",          "agents": [],                        "status": "live",    "description": "20 tests: routing tests, agent smoke tests, registry integrity checks."},
        {"name": "Structured Error Store",     "agents": [],                        "status": "live",    "description": "agent_errors table + in-memory ring buffer. Prerequisite for Sentry/Darwin."},
        {"name": "Filesystem Tool",            "agents": [],                        "status": "live",    "description": "Safe read/write/backup for Forge. Path validation, forbidden files list, .bak rollback."},
        {"name": "IT Department (Darwin+team)","agents": ["Darwin","Oracle","Forge","Shield","Scroll","Sentry"], "status": "planned", "description": "Phase 5: self-repair + self-create. Sentry monitors, Darwin coordinates, Forge fixes."},
    ]

    # Recent unresolved errors
    recent_errors = []
    try:
        import psycopg2
        from app.core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute("""
            SELECT agent, error_message, timestamp
            FROM agent_errors
            WHERE resolved = FALSE
            ORDER BY created_at DESC
            LIMIT 5
        """)
        recent_errors = [
            {"agent": r[0], "error": r[1][:120], "timestamp": r[2]}
            for r in cur.fetchall()
        ]
        cur.close()
        conn.close()
    except Exception:
        pass

    return {
        "agents": agents,
        "features": features,
        "phases": phases,
        "current_phase": "Option A — Advanced Orchestration",
        "recent_errors": recent_errors,
    }


# ── Mini-chat with platform context ──────────────────────────────────────────

class RoadmapChatRequest(BaseModel):
    message: str
    history: list[dict] = []


_SYSTEM_PROMPT_TEMPLATE = """You are Jazper's self-awareness layer — you know everything about the Sir Jazper OS platform and can explain it clearly.

PLATFORM STATE:
{context_json}

RULES:
- Answer only questions about this platform (features, agents, architecture, roadmap, issues)
- Be concise: 2–4 sentences unless asked for detail
- Use actual names from the platform (Scout, Hermes, Sage, etc.)
- If asked about something not in the context, say so honestly
- Do NOT make up features that are not listed above
- For "planned" features, clearly say they are not yet built
"""


@router.post("/chat")
async def roadmap_chat(req: RoadmapChatRequest):
    """Stream a mini-chat response with platform context injected."""

    async def stream():
        try:
            from app.providers.ai_provider import ai_provider

            # Fetch context fresh each request
            ctx = await roadmap_context()
            context_json = json.dumps(ctx, indent=2)
            system_prompt = _SYSTEM_PROMPT_TEMPLATE.format(context_json=context_json)

            messages = [{"role": "system", "content": system_prompt}]
            for h in req.history[-8:]:
                messages.append({"role": h.get("role", "user"), "content": h.get("content", "")})
            messages.append({"role": "user", "content": req.message})

            async for chunk in ai_provider.stream(messages, max_tokens=300, temperature=0.4):
                if chunk:
                    yield f"data: {json.dumps({'text': chunk})}\n\n"

            yield "data: [DONE]\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Notes (save conversations) ────────────────────────────────────────────────

class SaveNoteRequest(BaseModel):
    title: str = "Roadmap Note"
    messages: list[dict]


@router.post("/notes")
async def save_note(req: SaveNoteRequest):
    """Save a roadmap mini-chat conversation."""
    note_id = str(uuid.uuid4())
    try:
        import psycopg2
        from app.core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO roadmap_notes (id, title, messages) VALUES (%s, %s, %s)",
            (note_id, req.title, json.dumps(req.messages)),
        )
        conn.commit()
        cur.close()
        conn.close()
        return {"id": note_id, "title": req.title}
    except Exception as e:
        return {"error": str(e)}


@router.get("/notes")
async def list_notes():
    """List all saved roadmap notes."""
    try:
        import psycopg2
        from app.core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute("SELECT id, title, created_at FROM roadmap_notes ORDER BY created_at DESC LIMIT 30")
        notes = [
            {"id": str(r[0]), "title": r[1], "created_at": r[2].isoformat()}
            for r in cur.fetchall()
        ]
        cur.close()
        conn.close()
        return {"notes": notes}
    except Exception as e:
        return {"error": str(e), "notes": []}


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str):
    """Delete a saved note."""
    try:
        import psycopg2
        from app.core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute("DELETE FROM roadmap_notes WHERE id = %s", (note_id,))
        conn.commit()
        cur.close()
        conn.close()
        return {"deleted": note_id}
    except Exception as e:
        return {"error": str(e)}
