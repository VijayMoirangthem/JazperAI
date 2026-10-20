"""Company feature flow API (aliased /api/v1/features): start a feature run for a group's project, watch it, merge (Tier-3 approval) or discard."""
import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agents import feature_flow as ff
from agents import workspaces

router = APIRouter()


class RunIn(BaseModel):
    group: str
    task: str = Field(min_length=8, max_length=2000)
    repo: str | None = None  # default: the group's first workspace folder


@router.post("/runs")
async def start(body: RunIn):
    repo = body.repo or next((w["path"] for w in workspaces._cache.get(body.group, [])), None)
    if not repo:
        raise HTTPException(422, "this group has no workspace folder; add one in Connections")
    try:
        return await ff.start(body.group, body.task, repo)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.get("/runs")
async def runs():
    return {"runs": [ff.public(r) for r in ff.RUNS.values()]}


@router.get("/runs/{rid}")
async def get_run(rid: str):
    r = ff.RUNS.get(rid)
    if not r:
        raise HTTPException(404, "unknown run")
    return {**ff.public(r), "diff": r.get("diff", "")}


@router.post("/runs/{rid}/merge")
async def merge(rid: str):
    r = ff.RUNS.get(rid)
    if not r:
        raise HTTPException(404, "unknown run")
    if r.get("status") != "verified" or r.get("merge") in ("awaiting-approval", "merged"):
        raise HTTPException(409, "only a verified, not-yet-merged run can be merged")
    r["merge_handle"] = asyncio.create_task(ff.merge(rid))
    return {"id": rid, "merge": "awaiting-approval"}


@router.delete("/runs/{rid}")
async def discard(rid: str):
    if rid not in ff.RUNS:
        raise HTTPException(404, "unknown run")
    await ff.discard(rid)
    return {"discarded": rid}
