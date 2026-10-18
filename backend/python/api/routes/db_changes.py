from fastapi import APIRouter
from core.services.db_change_service import get_recent_changes, rollback_change

router = APIRouter(prefix="/api/db-changes", tags=["db-changes"])


@router.get("")
def list_changes(hours: int = 24, limit: int = 100):
    return {"changes": get_recent_changes(hours, limit)}


@router.post("/{change_id}/rollback")
def do_rollback(change_id: str):
    return rollback_change(change_id, rolled_back_by="user")
