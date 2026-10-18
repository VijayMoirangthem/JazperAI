"""Phase 22 — Smart Email Triage."""
from __future__ import annotations

import json
from typing import Optional

import structlog
import psycopg2.extras
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from memory.db.legacy_pg import _pg
from core.providers.ai_provider import ai_provider

router = APIRouter()
log = structlog.get_logger()

# Priority sort order for inbox
_PRIORITY_ORDER = {"critical": 0, "action": 1, "fyi": 2, "noise": 3}


def _ensure_triage_columns():
    """Add triage columns to notifications if not present."""
    for sql in [
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS triage_priority TEXT DEFAULT NULL",
        "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS triage_action TEXT DEFAULT NULL",
    ]:
        try:
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute(sql)
                conn.commit()
        except Exception:
            pass


# Ensure columns exist at import time
try:
    _ensure_triage_columns()
except Exception:
    pass


# ── Pydantic models ────────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    limit: int = 20


class TriagePatch(BaseModel):
    triage_priority: Optional[str] = None
    triage_action: Optional[str] = None


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze_triage(body: AnalyzeRequest):
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, title, body
                    FROM notifications
                    WHERE type = 'email' AND triage_priority IS NULL
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (body.limit,),
                )
                emails = [dict(r) for r in cur.fetchall()]

        if not emails:
            return {"analyzed": 0, "breakdown": {"critical": 0, "action": 0, "fyi": 0, "noise": 0}}

        emails_payload = [
            {
                "id": str(e["id"]),
                "subject": e["title"],
                "body_preview": (e.get("body") or "")[:300],
            }
            for e in emails
        ]

        prompt = (
            "Classify each email as one of: critical, action, fyi, noise.\n"
            "critical = urgent action needed (interview, offer, deadline)\n"
            "action = needs reply or follow-up\n"
            "fyi = informational, good to know\n"
            "noise = newsletters, promos, automated\n\n"
            'Return JSON array: [{"id": "...", "priority": "...", "suggested_action": "reply|archive|read|ignore"}]\n\n'
            f"Emails: {json.dumps(emails_payload)}"
        )

        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
            temperature=0.1,
            max_tokens=1000,
        )

        content = result.content.strip()
        # Extract JSON from response
        start = content.find("[")
        end = content.rfind("]") + 1
        if start == -1 or end == 0:
            raise ValueError("No JSON array in LLM response")
        classifications = json.loads(content[start:end])

        breakdown = {"critical": 0, "action": 0, "fyi": 0, "noise": 0}
        with _pg() as conn:
            with conn.cursor() as cur:
                for item in classifications:
                    priority = item.get("priority", "noise")
                    action = item.get("suggested_action", "ignore")
                    item_id = item.get("id")
                    if not item_id:
                        continue
                    cur.execute(
                        "UPDATE notifications SET triage_priority = %s, triage_action = %s WHERE id = %s::uuid",
                        (priority, action, item_id),
                    )
                    if priority in breakdown:
                        breakdown[priority] += 1
            conn.commit()

        return {"analyzed": len(classifications), "breakdown": breakdown}

    except HTTPException:
        raise
    except Exception as e:
        log.warning("triage_analyze failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("/inbox")
def triage_inbox():
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, title, body, type, read, triage_priority, triage_action, created_at
                    FROM notifications
                    WHERE type = 'email'
                    ORDER BY created_at DESC
                    """
                )
                rows = [dict(r) for r in cur.fetchall()]

        # Sort: critical=0, action=1, fyi=2, noise=3, NULL=4 then by created_at DESC
        rows.sort(key=lambda r: (_PRIORITY_ORDER.get(r.get("triage_priority") or "", 4),))

        return [
            {
                "id": str(r["id"]),
                "title": r["title"],
                "body": r.get("body") or "",
                "read": r.get("read", False),
                "triage_priority": r.get("triage_priority"),
                "triage_action": r.get("triage_action"),
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
            }
            for r in rows
        ]
    except Exception as e:
        log.warning("triage_inbox failed", error=str(e))
        raise HTTPException(500, str(e))


@router.patch("/{notification_id}")
def patch_triage(notification_id: str, body: TriagePatch):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "No fields to update")
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                set_clause = ", ".join(f"{k} = %s" for k in fields)
                values = list(fields.values()) + [notification_id]
                cur.execute(
                    f"UPDATE notifications SET {set_clause} WHERE id = %s::uuid",
                    values,
                )
            conn.commit()
        return {"ok": True}
    except Exception as e:
        log.warning("patch_triage failed", error=str(e))
        raise HTTPException(500, str(e))
