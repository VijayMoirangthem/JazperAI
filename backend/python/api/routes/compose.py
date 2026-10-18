"""Email compose helpers — draft improvement via AI."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from core.providers.ai_provider import ai_provider
import structlog

router = APIRouter()
log = structlog.get_logger()


class ImproveRequest(BaseModel):
    body: str
    tone: str = "professional"  # professional | friendly | concise


@router.post("/improve")
async def improve_draft(req: ImproveRequest):
    if not req.body.strip():
        raise HTTPException(400, "Body is required")

    tone_desc = {
        "professional": "polished and professional, suitable for a business context",
        "friendly":     "warm and friendly while remaining professional",
        "concise":      "concise and direct — keep it under 100 words",
    }.get(req.tone, "professional")

    prompt = f"""Improve this email draft. Make it {tone_desc}.
Keep the same meaning and intent. Return ONLY the improved email body — no subject line, no explanation, no meta-commentary.

Original draft:
{req.body}"""

    try:
        result = await ai_provider.chat(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.3-70b-versatile",
            temperature=0.4,
            max_tokens=400,
        )
        return {"improved": result.content.strip()}
    except Exception as e:
        log.warning("Email improvement failed", error=str(e))
        raise HTTPException(500, f"Improvement failed: {e}")
