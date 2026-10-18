"""Phase 24 — Salary Negotiation Coach."""
from __future__ import annotations

import json
from typing import Optional

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.providers.ai_provider import ai_provider

router = APIRouter()
log = structlog.get_logger()


# ── Pydantic models ─────────────────────────────────────────────────────────────

class SalaryAnalyzeRequest(BaseModel):
    offered_salary: float
    target_salary: float
    company: str
    role: str
    market_data: Optional[str] = ""
    experience_years: Optional[int] = 0


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _parse_json(raw: str) -> dict:
    """Parse AI JSON response, strip markdown fences if present."""
    text = raw.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


# ── Routes ──────────────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze_salary(body: SalaryAnalyzeRequest):
    """
    Analyze a salary negotiation situation and return:
    - 3 talking points
    - A counter-offer email script
    - Floor salary
    - Confidence level
    - Gap analysis
    """
    company = body.company.strip()
    role = body.role.strip()
    if not company or not role:
        raise HTTPException(400, "company and role are required")

    prompt = (
        f"You are a salary negotiation expert. The candidate has been offered "
        f"{body.offered_salary} but wants {body.target_salary} for a {role} role at {company}. "
        f"Experience: {body.experience_years} years. Market data: {body.market_data or 'not provided'}.\n\n"
        f"Generate:\n"
        f"1. 3 specific negotiation talking points (concrete, confident, not apologetic)\n"
        f"2. A counter-offer email script (2-3 paragraphs, professional tone, asks for {body.target_salary})\n"
        f"3. A \"floor\" salary — the minimum they should accept\n\n"
        f'Return JSON: {{"talking_points": ["...", "...", "..."], "counter_offer_script": "...", '
        f'"floor_salary": 95000, "confidence_level": "high|medium|low", '
        f'"gap_analysis": "one sentence on how realistic the ask is"}}\n'
        f"Return ONLY valid JSON, no markdown."
    )

    # Fallback values
    fallback = {
        "talking_points": [
            "Highlight your relevant experience and the value you bring to this role.",
            "Reference market rates for similar positions to support your ask.",
            "Express strong interest in the role while clearly stating your target compensation.",
        ],
        "counter_offer_script": (
            f"Thank you for the offer of {body.offered_salary} for the {role} position at {company}. "
            f"I am very excited about this opportunity and the team.\n\n"
            f"Based on my {body.experience_years} years of experience and current market rates, "
            f"I was hoping we could reach {body.target_salary}. "
            f"I believe this reflects the value I will bring to the role.\n\n"
            f"I am flexible and open to discussing the full compensation package. "
            f"Please let me know if there is room to move on the base salary."
        ),
        "floor_salary": body.offered_salary,
        "confidence_level": "medium",
        "gap_analysis": "Unable to generate analysis — using fallback response.",
    }

    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            max_tokens=600,
            temperature=0.4,
        )
        parsed = _parse_json(result.content)
        return {
            "talking_points": parsed.get("talking_points", fallback["talking_points"]),
            "counter_offer_script": parsed.get("counter_offer_script", fallback["counter_offer_script"]),
            "floor_salary": parsed.get("floor_salary", fallback["floor_salary"]),
            "confidence_level": parsed.get("confidence_level", fallback["confidence_level"]),
            "gap_analysis": parsed.get("gap_analysis", fallback["gap_analysis"]),
            "offered_salary": body.offered_salary,
            "target_salary": body.target_salary,
        }
    except Exception as exc:
        log.warning("salary_coach: AI parse failed, using fallback", error=str(exc))
        return {**fallback, "offered_salary": body.offered_salary, "target_salary": body.target_salary}
