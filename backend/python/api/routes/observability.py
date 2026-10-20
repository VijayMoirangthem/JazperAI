"""G4: Prometheus /metrics (root path, local only) and SLO / error-budget status."""
from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from core import metrics

router = APIRouter()
metrics_router = APIRouter()


@router.get("/")
async def slo(window_minutes: int = 1440):
    return await metrics.slo_status_async(max(1, min(window_minutes, metrics.WINDOW_MIN)))


@metrics_router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
async def prometheus():
    return PlainTextResponse(await metrics.render(), media_type="text/plain; version=0.0.4")


@router.get("/chaos")
async def chaos_list():
    from agents import chaos
    return {"experiments": [{"name": n, "hypothesis": (f.__doc__ or "").strip()} for n, f in chaos.EXPERIMENTS.items()], "results": chaos.RESULTS}


@router.post("/chaos/{name}")
async def chaos_run(name: str):
    """Sandbox-only fault injection (see agents/chaos.py). Never targets live providers, connectors or processes."""
    from fastapi import HTTPException

    from agents import chaos
    if name != "all" and name not in chaos.EXPERIMENTS:
        raise HTTPException(404, "unknown experiment")
    return {"results": await chaos.run_all()} if name == "all" else await chaos.run(name)
