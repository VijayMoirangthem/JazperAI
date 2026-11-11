"""Performance Settings, agent activation and live resource monitor.

  GET  /api/performance/status            real CPU/RAM/processes/agents/tasks + warnings
  GET  /api/performance/settings          current settings + preset definitions
  PUT  /api/performance/settings          partial update (validated); preset becomes "custom"
  POST /api/performance/preset/{name}     eco | balanced | performance (?dry_run=true previews what would be deactivated)
  GET  /api/performance/agents            every agent with active / critical flags (?include_inactive=false hides inactive ones)
  PUT  /api/performance/agents/{slug}     activate / deactivate one agent
  POST /api/performance/agents/bulk       activate / deactivate many (critical agents are never touched)
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ValidationError

from agents import activation
from core.perf import monitor, runtime, settings as perf_settings

router = APIRouter()


def _http(e: activation.ActivationError) -> HTTPException:
    return HTTPException({"not_found": 404, "not_implemented": 422}.get(e.code, 409), {"code": e.code, "message": e.message})


@router.get("/status")
async def status():
    return await monitor.status()


@router.post("/memory/release")
async def release_memory():
    """"Free memory" button: unload the embedding models now and report the real RAM change (they reload on next use)."""
    import asyncio
    from core.services import embedding_service
    before = (await monitor.status())["rss_mb"]
    res = await asyncio.to_thread(embedding_service.unload, True)
    await asyncio.sleep(0.5)
    after = (await monitor.status())["rss_mb"]
    return {**res, "rss_mb_before": before, "rss_mb_after": after, "freed_mb": round(before - after, 1)}


@router.get("/settings")
async def get_settings():
    return {"settings": perf_settings.current().model_dump(),
            "presets": {n: perf_settings.preset_values(n) for n in perf_settings.PRESETS}}


@router.put("/settings")
async def put_settings(patch: dict):
    try:
        cfg = await perf_settings.update(patch)
    except ValidationError as e:
        raise HTTPException(422, [{"field": ".".join(map(str, x["loc"])), "message": x["msg"]} for x in e.errors()])
    runtime.apply(cfg)
    await activation.bust_caches()  # show_inactive_agents changes what the roster/tree return
    return {"settings": cfg.model_dump(), "over_cap": await activation.plan_for_cap(cfg.max_active_agents)}


@router.post("/preset/{name}")
async def apply_preset(name: str, dry_run: bool = Query(False), enforce_cap: bool = Query(True)):
    if name not in perf_settings.PRESETS:
        raise HTTPException(404, f"unknown preset '{name}' (use {', '.join(perf_settings.PRESETS)})")
    new = perf_settings.preset(name)
    plan = await activation.plan_for_cap(new.max_active_agents) if enforce_cap else []
    if dry_run:
        return {"dry_run": True, "settings": new.model_dump(), "would_deactivate": plan}
    cfg = await perf_settings.apply_preset(name)
    deactivated = (await activation.bulk(plan, False, reason=f"{name} preset")) if plan else {"changed": [], "skipped": []}
    runtime.apply(cfg)
    await activation.bust_caches()
    return {"settings": cfg.model_dump(), "deactivated": deactivated["changed"], "counts": activation.counts()}


@router.get("/agents")
async def agents(include_inactive: bool = Query(True)):
    from agents.registry import registry
    rows = activation.annotate(registry.roster())
    rows = [r for r in rows if r["implemented"]]
    if not include_inactive:
        rows = [r for r in rows if r["active"]]
    return {"agents": rows, "counts": activation.counts(), "critical": sorted(activation.CRITICAL)}


class SetIn(BaseModel):
    active: bool
    force: bool = False
    reason: str = ""


@router.put("/agents/{slug}")
async def set_agent(slug: str, body: SetIn):
    try:
        return await activation.set_active(slug, body.active, force=body.force, reason=body.reason)
    except activation.ActivationError as e:
        raise _http(e)


class BulkIn(BaseModel):
    active: bool
    slugs: list[str] | None = None   # explicit list, or ...
    crew: str | None = None          # ... every agent of a crew, or ...
    all: bool = False                # ... every implemented agent
    reason: str = ""


@router.post("/agents/bulk")
async def bulk(body: BulkIn):
    from agents.registry import registry
    roster = [r for r in registry.roster() if activation.implemented(r)]
    if body.slugs is not None:
        slugs = body.slugs
    elif body.crew:
        slugs = [r["slug"] for r in roster if r.get("crew") == body.crew]
    elif body.all:
        slugs = [r["slug"] for r in roster]
    else:
        raise HTTPException(422, "give slugs, crew, or all=true")
    return await activation.bulk(slugs, body.active, reason=body.reason)
