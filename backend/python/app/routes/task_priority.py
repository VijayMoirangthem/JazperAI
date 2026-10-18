"""Phase 23 — Smart Task Prioritization."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import psycopg2.extras
import structlog
from fastapi import APIRouter, HTTPException

from app.providers.ai_provider import get_ai_provider
from app.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


# ── Helpers ────────────────────────────────────────────────────────────────────

def _safe_str(v) -> str:
    """Convert dates/datetimes/UUIDs to strings for JSON serialisation."""
    if v is None:
        return ""
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze_priorities():
    """Fetch all pending tasks, re-rank via LLM, cache results."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, title, notes AS description,
                           due_at AS due_date, priority, status, created_at
                    FROM tasks
                    WHERE status != 'done'
                    ORDER BY created_at ASC
                    """
                )
                tasks = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        log.warning("task_priority: DB fetch failed", error=str(e))
        raise HTTPException(500, str(e))

    analyzed_at = datetime.now(timezone.utc).isoformat()

    if not tasks:
        return {"ranked": [], "analyzed_at": analyzed_at}

    # Serialise task list for the prompt
    tasks_for_prompt = [
        {k: _safe_str(v) if hasattr(v, "isoformat") else (str(v) if v is not None else "") for k, v in t.items()}
        for t in tasks
    ]
    tasks_json = json.dumps(tasks_for_prompt, default=str)

    prompt = (
        "You are a productivity coach. Re-rank these tasks by urgency and impact for a job seeker.\n"
        "Consider: due dates (overdue = critical), job application tasks = high priority, "
        "habit/personal = lower.\n"
        'Return JSON array: [{"id": "...", "rank": 1, "urgency": "critical|high|medium|low", '
        '"reason": "one short sentence"}]\n'
        "Sort by rank ascending (1 = most urgent).\n"
        f"Tasks: {tasks_json}"
    )

    ranked: list[dict] = []
    try:
        provider = get_ai_provider()
        result = await provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
            max_tokens=600,
            temperature=0.3,
        )
        raw = result.content.strip()
        start = raw.find("[")
        end = raw.rfind("]") + 1
        if start != -1 and end > start:
            ranked = json.loads(raw[start:end])
        else:
            ranked = json.loads(raw)
    except Exception as e:
        log.warning("task_priority: LLM failed, using fallback order", error=str(e))
        ranked = [
            {"id": str(t["id"]), "rank": i + 1, "urgency": "medium", "reason": "Default ordering"}
            for i, t in enumerate(tasks)
        ]

    # Upsert cache
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                for item in ranked:
                    cur.execute(
                        """
                        INSERT INTO task_priority_cache (task_id, rank, urgency, reason, analyzed_at)
                        VALUES (%s::uuid, %s, %s, %s, NOW())
                        ON CONFLICT (task_id) DO UPDATE
                          SET rank        = EXCLUDED.rank,
                              urgency     = EXCLUDED.urgency,
                              reason      = EXCLUDED.reason,
                              analyzed_at = NOW()
                        """,
                        (
                            item.get("id"),
                            int(item.get("rank", 0)),
                            item.get("urgency", "medium"),
                            item.get("reason", ""),
                        ),
                    )
            conn.commit()
    except Exception as e:
        log.warning("task_priority: cache upsert failed (non-fatal)", error=str(e))

    id_to_title = {str(t["id"]): t["title"] for t in tasks}
    result_list = [
        {
            "id": str(item.get("id", "")),
            "title": id_to_title.get(str(item.get("id", "")), ""),
            "rank": item.get("rank"),
            "urgency": item.get("urgency", "medium"),
            "reason": item.get("reason", ""),
        }
        for item in ranked
    ]

    return {"ranked": result_list, "analyzed_at": analyzed_at}


@router.get("")
def get_priorities():
    """Return latest cached priorities joined with tasks table."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT tpc.task_id, tpc.rank, tpc.urgency, tpc.reason, tpc.analyzed_at,
                           t.title, t.status, t.priority, t.due_at AS due_date
                    FROM task_priority_cache tpc
                    JOIN tasks t ON t.id = tpc.task_id
                    ORDER BY tpc.rank ASC
                    """
                )
                rows = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(500, str(e))

    if not rows:
        return {"cached": False, "items": []}

    return {
        "cached": True,
        "items": [
            {
                "task_id": str(r["task_id"]),
                "title": r["title"],
                "rank": r["rank"],
                "urgency": r["urgency"],
                "reason": r["reason"],
                "status": r["status"],
                "priority": r["priority"],
                "due_date": r["due_date"].isoformat() if r.get("due_date") else None,
                "analyzed_at": r["analyzed_at"].isoformat() if r.get("analyzed_at") else None,
            }
            for r in rows
        ],
    }
