"""Phase 10A — Briefing schedule API."""
from fastapi import APIRouter
from pydantic import BaseModel
import structlog

from core.services.briefing_service import (
    get_briefing_config,
    save_briefing_config,
    get_briefing_history,
    generate_and_send_briefing,
)

log = structlog.get_logger()
router = APIRouter()


class BriefingConfigUpdate(BaseModel):
    morning_enabled:  bool | None = None
    morning_hour:     int | None = None
    morning_minute:   int | None = None
    evening_enabled:  bool | None = None
    evening_hour:     int | None = None
    evening_minute:   int | None = None
    include_calendar: bool | None = None
    include_email:    bool | None = None
    include_jobs:     bool | None = None


@router.get("/config")
def config_get():
    return get_briefing_config()


@router.post("/config")
def config_update(body: BriefingConfigUpdate):
    updates = body.model_dump(exclude_none=True)
    save_briefing_config(updates)
    # Re-sync scheduler so the new times take effect immediately
    try:
        from core.scheduler.scheduler import sync_briefings
        sync_briefings()
    except Exception as e:
        log.warning("sync_briefings failed after config update", error=str(e))
    return {"ok": True, "config": get_briefing_config()}


@router.post("/send-now")
async def send_now(briefing_type: str = "morning"):
    if briefing_type not in ("morning", "evening"):
        return {"ok": False, "error": "type must be 'morning' or 'evening'"}
    result = await generate_and_send_briefing(briefing_type)
    return {"ok": True, **result}


@router.get("/history")
def history(limit: int = 10):
    return get_briefing_history(min(limit, 50))


@router.get("/preview")
async def preview(briefing_type: str = "morning"):
    """Generate a briefing and return it without sending to Telegram."""
    from core.services.briefing_service import (
        get_briefing_config as _cfg,
        _collect_data,
        _format_briefing,
    )
    config  = _cfg()
    data    = await _collect_data(briefing_type, config)
    message = await _format_briefing(briefing_type, data)
    return {"ok": True, "message": message, "chars": len(message)}
