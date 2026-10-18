"""Phase 21 — Interview Prep: question generation + answer rating."""
from __future__ import annotations

import json
import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import psycopg2.extras

from memory.db.legacy_pg import _pg
from core.providers.ai_provider import ai_provider

router = APIRouter()
log = structlog.get_logger()

_FALLBACK_QUESTIONS = [
    {"q": "Tell me about yourself and your background.", "category": "behavioral"},
    {"q": "Describe a challenging project you worked on and how you handled it.", "category": "behavioral"},
    {"q": "Give an example of a time you showed leadership.", "category": "behavioral"},
    {"q": "What are your key technical skills relevant to this role?", "category": "technical"},
    {"q": "Walk me through how you would approach a complex technical problem.", "category": "technical"},
    {"q": "How would you handle a tight deadline with competing priorities?", "category": "situational"},
    {"q": "If a teammate disagreed with your approach, how would you resolve it?", "category": "situational"},
    {"q": "What draws you to this company and how do you see yourself contributing?", "category": "culture"},
]


# ── Pydantic models ────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    company: str
    role: str
    job_description: str = ""


class RateRequest(BaseModel):
    question: str
    answer: str
    company: str
    role: str


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_questions(body: GenerateRequest):
    company = body.company.strip()
    role = body.role.strip()
    if not company or not role:
        raise HTTPException(400, "company and role are required")

    prompt = (
        f"Generate 8 interview questions for a {role} position at {company}. "
        f"Mix: 3 behavioral (STAR), 2 technical/domain, 2 situational, 1 culture-fit. "
        f"Return as JSON array: [{{\"q\": \"...\", \"category\": \"behavioral|technical|situational|culture\"}}]. "
        f"Return ONLY valid JSON, no markdown."
    )
    if body.job_description:
        prompt += f"\n\nJob description context: {body.job_description[:800]}"

    questions = _FALLBACK_QUESTIONS[:]
    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            max_tokens=800,
            temperature=0.7,
        )
        raw = result.content.strip()
        # Strip any accidental markdown fences
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw)
        if isinstance(parsed, list) and parsed:
            questions = parsed[:8]
    except Exception as exc:
        log.warning("interview_prep: question parse failed, using fallback", error=str(exc))

    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO interview_prep_sessions (company, role, questions)
                    VALUES (%s, %s, %s)
                    RETURNING id, company, role, questions, created_at
                    """,
                    (company, role, json.dumps(questions)),
                )
                row = dict(cur.fetchone())
            conn.commit()
        return {
            "session_id": str(row["id"]),
            "company": row["company"],
            "role": row["role"],
            "questions": row["questions"],
            "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        }
    except Exception as exc:
        log.error("interview_prep: db insert failed", error=str(exc))
        raise HTTPException(500, str(exc))


@router.post("/rate")
async def rate_answer(body: RateRequest):
    question = body.question.strip()
    answer = body.answer.strip()
    if not question or not answer:
        raise HTTPException(400, "question and answer are required")

    prompt = (
        f"Rate this interview answer for a {body.role} at {body.company}.\n"
        f"Question: {question}\n"
        f"Answer: {answer}\n\n"
        f'Return JSON: {{"score": 7.5, "feedback": "one sentence summary", "tips": ["tip 1", "tip 2", "tip 3"]}}. '
        f"Score 1-10. Return ONLY valid JSON."
    )

    score = 5.0
    feedback = "Could not rate answer."
    tips: list[str] = []

    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
            max_tokens=400,
            temperature=0.3,
        )
        raw = result.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw)
        score = float(parsed.get("score", 5.0))
        feedback = parsed.get("feedback", "")
        tips = parsed.get("tips", [])
    except Exception as exc:
        log.warning("interview_prep: rate parse failed, using fallback", error=str(exc))

    # Persist to interview_answers (no required session_id)
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO interview_answers (question, answer, score, feedback, tips)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (question, answer, score, feedback, json.dumps(tips)),
                )
            conn.commit()
    except Exception as exc:
        log.warning("interview_prep: answer save failed (non-fatal)", error=str(exc))

    return {"score": score, "feedback": feedback, "tips": tips}


@router.get("/sessions")
def list_sessions():
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, company, role, questions, created_at
                    FROM interview_prep_sessions
                    ORDER BY created_at DESC
                    LIMIT 50
                    """
                )
                rows = [dict(r) for r in cur.fetchall()]
        return [
            {
                "session_id": str(r["id"]),
                "company": r["company"],
                "role": r["role"],
                "question_count": len(r["questions"]) if isinstance(r["questions"], list) else 0,
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
            }
            for r in rows
        ]
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM interview_prep_sessions WHERE id = %s",
                    (session_id,),
                )
                row = cur.fetchone()
                if not row:
                    raise HTTPException(404, "Session not found")
                session = dict(row)

                cur.execute(
                    """
                    SELECT id, question, answer, score, feedback, tips, created_at
                    FROM interview_answers
                    WHERE session_id = %s
                    ORDER BY created_at
                    """,
                    (session_id,),
                )
                answers = [dict(a) for a in cur.fetchall()]

        return {
            "session_id": str(session["id"]),
            "company": session["company"],
            "role": session["role"],
            "questions": session["questions"],
            "created_at": session["created_at"].isoformat() if session.get("created_at") else None,
            "answers": [
                {
                    "id": str(a["id"]),
                    "question": a["question"],
                    "answer": a["answer"],
                    "score": a["score"],
                    "feedback": a["feedback"],
                    "tips": a["tips"],
                    "created_at": a["created_at"].isoformat() if a.get("created_at") else None,
                }
                for a in answers
            ],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, str(exc))


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM interview_prep_sessions WHERE id = %s",
                    (session_id,),
                )
            conn.commit()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(500, str(exc))
