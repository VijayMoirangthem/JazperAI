"""Phase 23 — Job Application Follow-up Automator."""
from __future__ import annotations

import json

import psycopg2.extras
import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.providers.ai_provider import get_ai_provider
from memory.db.legacy_pg import _pg

router = APIRouter()
log = structlog.get_logger()


# ── Pydantic models ────────────────────────────────────────────────────────────

class DraftBody(BaseModel):
    application_id: str
    followup_type: str  # 'first' | 'second' | 'final'


class MarkSentBody(BaseModel):
    application_id: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _ensure_followup_column() -> None:
    """Add last_followup_at to job_applications if it does not exist."""
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "ALTER TABLE job_applications "
                    "ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMPTZ DEFAULT NULL"
                )
            conn.commit()
    except Exception:
        pass


def _followup_type_label(days: int) -> str:
    if days <= 7:
        return "first"
    elif days <= 14:
        return "second"
    return "final"


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/due")
def get_due_followups():
    """Find applications where 7, 14, or 21 days have elapsed since applying."""
    _ensure_followup_column()
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, company, title, applied_at, status, last_followup_at,
                           ABS(EXTRACT(days FROM NOW() - applied_at))::int AS days_since
                    FROM job_applications
                    WHERE status IN ('applied', 'viewed')
                      AND applied_at IS NOT NULL
                      AND last_followup_at IS NULL
                      AND ABS(EXTRACT(days FROM NOW() - applied_at))::int IN (7, 14, 21)
                    ORDER BY applied_at ASC
                    """
                )
                rows = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(500, str(e))

    return {
        "due": [
            {
                "id": r["id"],
                "company": r["company"],
                "job_title": r["title"],
                "applied_at": r["applied_at"].isoformat() if r.get("applied_at") else None,
                "days_since": r["days_since"],
                "suggested_followup_type": _followup_type_label(r["days_since"]),
            }
            for r in rows
        ]
    }


@router.post("/draft")
async def draft_followup(body: DraftBody):
    """Generate a polite follow-up email draft for a job application."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, company, title, applied_at FROM job_applications WHERE id = %s",
                    (body.application_id,),
                )
                row = cur.fetchone()
    except Exception as e:
        raise HTTPException(500, str(e))

    if not row:
        raise HTTPException(404, "Application not found")

    row = dict(row)
    applied_str = (
        row["applied_at"].strftime("%B %d, %Y") if row.get("applied_at") else "recently"
    )
    followup_labels = {
        "first":  "first follow-up (sent one week after applying)",
        "second": "second follow-up (sent two weeks after applying)",
        "final":  "final follow-up (sent three weeks after applying)",
    }
    label = followup_labels.get(body.followup_type, "follow-up")

    prompt = (
        f"Write a polite, professional {label} email for a job application.\n"
        f"Company: {row['company']}\n"
        f"Job title: {row['title']}\n"
        f"Applied on: {applied_str}\n"
        "Keep it concise (3-5 sentences). Express continued interest, mention the application date, "
        "and politely ask if there is any update on the hiring process.\n"
        'Return only JSON: {"subject": "...", "body": "..."}'
    )

    try:
        provider = get_ai_provider()
        result = await provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            max_tokens=400,
            temperature=0.5,
        )
        raw = result.content.strip()
        start = raw.find("{")
        end = raw.rfind("}") + 1
        data = json.loads(raw[start:end]) if start != -1 and end > start else {}
        subject = data.get("subject") or f"Following Up: {row['title']} Application"
        body_text = data.get("body") or raw
    except Exception as e:
        log.warning("followup: LLM draft failed, using fallback", error=str(e))
        subject = f"Following Up: {row['title']} Application"
        body_text = (
            f"Hi,\n\nI wanted to follow up on my application for the {row['title']} position "
            f"at {row['company']}, submitted on {applied_str}. I remain very interested in this "
            "opportunity and would appreciate any updates on the hiring timeline.\n\n"
            "Thank you for your time.\n\nBest regards"
        )

    return {
        "subject": subject,
        "body": body_text,
        "company": row["company"],
        "job_title": row["title"],
    }


@router.post("/mark-sent")
def mark_sent(body: MarkSentBody):
    """Record that a follow-up was sent for an application."""
    _ensure_followup_column()
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE job_applications SET last_followup_at = NOW() WHERE id = %s",
                    (body.application_id,),
                )
                updated = cur.rowcount
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))

    if updated == 0:
        raise HTTPException(404, "Application not found")
    return {"ok": True, "application_id": body.application_id}


@router.get("/history")
def followup_history():
    """List all applications that have had at least one follow-up sent."""
    _ensure_followup_column()
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, company, title, applied_at, status, last_followup_at
                    FROM job_applications
                    WHERE last_followup_at IS NOT NULL
                    ORDER BY last_followup_at DESC
                    """
                )
                rows = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(500, str(e))

    return {
        "history": [
            {
                "id": r["id"],
                "company": r["company"],
                "job_title": r["title"],
                "applied_at": r["applied_at"].isoformat() if r.get("applied_at") else None,
                "status": r["status"],
                "last_followup_at": (
                    r["last_followup_at"].isoformat() if r.get("last_followup_at") else None
                ),
            }
            for r in rows
        ]
    }
