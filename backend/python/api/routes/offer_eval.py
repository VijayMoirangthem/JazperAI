"""Phase 24 — Job Offer Evaluator."""
from __future__ import annotations

import json
from typing import Optional

import psycopg2.extras
import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.providers.ai_provider import ai_provider
from core.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


# ── Pydantic models ─────────────────────────────────────────────────────────────

class OfferEvalCreate(BaseModel):
    company: str
    role: str
    base_salary: float
    equity: Optional[str] = ""
    pto_days: Optional[int] = 0
    remote_type: Optional[str] = "hybrid"
    bonus: Optional[float] = 0.0
    other_perks: Optional[str] = ""
    application_id: Optional[str] = None


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _fmt(r: dict) -> dict:
    out = {}
    for k, v in r.items():
        if v is None:
            out[k] = None
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        elif hasattr(v, "hex"):
            out[k] = str(v)
        else:
            out[k] = v
    return out


def _parse_eval(raw: str) -> dict:
    """Parse AI JSON response, strip markdown fences if present."""
    text = raw.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


# ── Routes ──────────────────────────────────────────────────────────────────────

@router.get("/compare")
def compare_evaluations():
    """Return all evaluations sorted by score DESC for side-by-side comparison.
    Returns 400 if fewer than 2 evaluations exist."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM offer_evaluations ORDER BY score DESC"
                )
                rows = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(500, str(e))

    if len(rows) < 2:
        raise HTTPException(400, "Need at least 2 evaluations to compare")
    return {"evaluations": [_fmt(r) for r in rows], "count": len(rows)}


@router.get("")
def list_evaluations():
    """List all offer evaluations, most recent first."""
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM offer_evaluations ORDER BY created_at DESC"
                )
                rows = [dict(r) for r in cur.fetchall()]
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"evaluations": [_fmt(r) for r in rows]}


@router.post("")
async def create_evaluation(body: OfferEvalCreate):
    """Evaluate a job offer with AI, save, and return the full evaluation."""
    company = body.company.strip()
    role = body.role.strip()
    if not company or not role:
        raise HTTPException(400, "company and role are required")

    prompt = (
        f"Evaluate this job offer for a software engineer/developer. Score it 1-10 and provide analysis.\n"
        f"Offer: Company={company}, Role={role}, Base={body.base_salary}, "
        f"Equity={body.equity}, PTO={body.pto_days} days, Remote={body.remote_type}, "
        f"Bonus={body.bonus}, Perks={body.other_perks}\n"
        f'Return JSON: {{"score": 7.5, "analysis": "2-3 sentence summary", '
        f'"pros": ["list of 3-4 pros"], "cons": ["list of 2-3 cons"]}}\n'
        f"Return ONLY valid JSON, no markdown."
    )

    score = 0.0
    analysis = ""
    pros: list = []
    cons: list = []

    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            max_tokens=500,
            temperature=0.3,
        )
        parsed = _parse_eval(result.content)
        score = float(parsed.get("score", 0))
        analysis = str(parsed.get("analysis", ""))
        pros = parsed.get("pros", [])
        cons = parsed.get("cons", [])
    except Exception as exc:
        log.warning("offer_eval: AI parse failed", error=str(exc))

    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO offer_evaluations
                        (application_id, company, role, base_salary, equity, pto_days,
                         remote_type, bonus, other_perks, score, analysis, pros, cons)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
                    RETURNING *
                    """,
                    (
                        body.application_id,
                        company,
                        role,
                        body.base_salary,
                        body.equity or "",
                        body.pto_days or 0,
                        body.remote_type or "hybrid",
                        body.bonus or 0.0,
                        body.other_perks or "",
                        score,
                        analysis,
                        json.dumps(pros),
                        json.dumps(cons),
                    ),
                )
                row = dict(cur.fetchone())
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))

    return _fmt(row)


@router.delete("/{eval_id}")
def delete_evaluation(eval_id: str):
    """Delete an offer evaluation by ID."""
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM offer_evaluations WHERE id = %s::uuid",
                    (eval_id,),
                )
                deleted = cur.rowcount
            conn.commit()
    except Exception as e:
        raise HTTPException(500, str(e))

    if deleted == 0:
        raise HTTPException(404, "Evaluation not found")
    return {"ok": True, "deleted_id": eval_id}
