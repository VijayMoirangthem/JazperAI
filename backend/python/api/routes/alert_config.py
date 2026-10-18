"""Phase 10B — Alert configuration CRUD."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from core.services.alert_service import get_alert_config, save_alert_config

router = APIRouter()


class AlertConfigUpdate(BaseModel):
    recruiter_email: bool | None = None
    interview_invite: bool | None = None
    job_rejection: bool | None = None
    offer_letter: bool | None = None
    action_required: bool | None = None
    important_email: bool | None = None


@router.get("")
def get_config():
    return get_alert_config()


@router.post("")
def update_config(body: AlertConfigUpdate):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields provided")
    save_alert_config(updates)
    return get_alert_config()
