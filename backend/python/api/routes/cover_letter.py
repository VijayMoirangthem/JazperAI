"""Cover letter generator using Resume Manager + Atlas/LLM."""
from __future__ import annotations
import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from core.providers.ai_provider import ai_provider
from core.services.memory_service import _pg

router = APIRouter()
log = structlog.get_logger()


def _get_profile() -> dict:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT full_name, headline, skills, resume_text
                FROM user_profile WHERE id = 1
            """)
            row = cur.fetchone()
    if not row:
        return {}
    return {
        "name": row[0] or "VJ",
        "headline": row[1] or "",
        "skills": row[2] or [],
        "resume_text": row[3] or "",
    }


def _get_job(job_id: str) -> dict | None:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT company, title, description FROM job_applications WHERE id = %s",
                (job_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    return {"company": row[0], "title": row[1], "description": row[2] or ""}


class GenerateRequest(BaseModel):
    job_id: str
    notes: str = ""


class SaveRequest(BaseModel):
    job_id: str
    cover_letter: str


@router.post("/generate")
async def generate(body: GenerateRequest):
    profile = _get_profile()
    job = _get_job(body.job_id)
    if not job:
        raise HTTPException(404, "Job application not found")

    resume_snippet = profile.get("resume_text", "")[:2000]
    skills_str = ", ".join(profile.get("skills", [])[:12])

    prompt = f"""Write a professional cover letter for this job application.

Applicant: {profile.get('name', 'VJ')}
Skills: {skills_str}
Resume summary (partial): {resume_snippet[:800] if resume_snippet else "Not provided"}

Job: {job['title']} at {job['company']}
Job description: {job['description'][:600] if job['description'] else "Not provided"}

Additional notes from applicant: {body.notes}

Requirements:
- Under 300 words
- 3 paragraphs: opening (why this role + company), middle (2-3 specific skills/achievements), closing (call to action)
- Professional but not stiff — genuine enthusiasm
- No placeholders like [Your Name] — use the actual name
- No markdown, just plain text
"""

    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            temperature=0.7,
            max_tokens=500,
        )
        letter = result.content.strip()
        return {"cover_letter": letter, "job": job}
    except Exception as e:
        log.warning("Cover letter generation failed", error=str(e))
        raise HTTPException(500, f"Generation failed: {e}")


@router.post("/save")
def save(body: SaveRequest):
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE job_applications SET cover_letter = %s WHERE id = %s",
                (body.cover_letter, body.job_id),
            )
        conn.commit()
    return {"ok": True}


class ReviewRequest(BaseModel):
    cover_letter: str
    job_title: str = ""
    company: str = ""


@router.post("/review")
async def review_cover_letter(body: ReviewRequest):
    if not body.cover_letter.strip():
        raise HTTPException(400, "Cover letter required")

    prompt = f"""You are a professional career coach. Review this cover letter for a {body.job_title} role at {body.company}.

Cover letter:
{body.cover_letter}

Give exactly 3 specific, actionable improvement suggestions. Each suggestion must:
- Be 1-2 sentences
- Reference a specific part of the letter
- Explain how to improve it

Respond as a JSON array of 3 strings: ["suggestion 1", "suggestion 2", "suggestion 3"]
Return ONLY the JSON array, nothing else."""

    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            temperature=0.3,
            max_tokens=300,
        )
        import json as _json
        raw = result.content.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        suggestions = _json.loads(raw)
        if not isinstance(suggestions, list):
            suggestions = [str(suggestions)]
        return {"suggestions": suggestions[:3]}
    except Exception as e:
        log.warning("Cover letter review failed", error=str(e))
        raise HTTPException(500, f"Review failed: {e}")
