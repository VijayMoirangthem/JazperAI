"""LLM-generated reply drafts for incoming emails."""
from fastapi import APIRouter
from pydantic import BaseModel
import structlog

from app.providers.ai_provider import get_ai_provider

router = APIRouter()
log = structlog.get_logger()


class DraftRequest(BaseModel):
    from_email: str
    subject: str
    body_preview: str = ""
    tone: str = "professional"  # professional | friendly | concise


@router.post("/draft")
async def generate_reply_draft(req: DraftRequest):
    ai = get_ai_provider()
    system = (
        "You are Jazper, a personal AI assistant. Your user received an email and wants a draft reply. "
        "Write ONLY the reply body — no subject line, no 'Hi/Dear' header unless natural, no sign-off. "
        "Keep it concise. Match the requested tone."
    )
    prompt = (
        f"Email from: {req.from_email}\n"
        f"Subject: {req.subject}\n"
        f"Message preview: {req.body_preview or '(no body preview available)'}\n\n"
        f"Write a {req.tone} reply draft:"
    )
    try:
        draft = await ai.complete(prompt, system_prompt=system, max_tokens=300)
        return {"draft": draft.strip()}
    except Exception as e:
        log.warning("Draft generation failed", error=str(e))
        return {"draft": "", "error": str(e)}
