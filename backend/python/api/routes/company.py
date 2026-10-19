"""Company structure + executive directives (aliased /api/v1/company)."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agents import org
from agents.exec_graph import run_directive

router = APIRouter()


class DirectiveIn(BaseModel):
    text: str
    executive: str | None = None  # default: keyword pre-classifier


@router.get("/structure")
async def structure():
    return {"executives": [{"slug": e.slug, "title": e.title, "duty": e.duty, "crews": list(e.crews)} for e in org.EXECUTIVES],
            "crews": {k: {"name": v[0], "reports_to": v[1], "members": [{"slug": m[0], "title": m[1], "duty": m[2]} for m in v[2]]} for k, v in org.CREWS.items()}}


@router.post("/seed")
async def seed():
    return {"created": await org.ensure_org()}


@router.post("/directive")
async def directive(body: DirectiveIn):
    try:
        return await run_directive(body.text, body.executive)
    except LookupError:
        raise HTTPException(404, "unknown executive")
