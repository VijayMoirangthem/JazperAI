"""GET /api/directory (aliased at /api/v1/directory): humans + bots with tenants/roles."""
from fastapi import APIRouter

from core import directory

router = APIRouter()


@router.get("/")
async def get_directory():
    return {
        "humans": [h.model_dump() for h in directory.humans()],
        "bots": [b.model_dump(mode="json") for b in directory.bots()],
    }
