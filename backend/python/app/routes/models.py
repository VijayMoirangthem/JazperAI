from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.providers.ai_provider import ai_provider
from app.core.config import settings
import httpx

router = APIRouter()

# LM Studio's load endpoint lives at the base URL without /v1
_LM_BASE = settings.AI_BASE_URL.removesuffix("/v1")


class LoadModelRequest(BaseModel):
    model: str
    contextLength: int | None = None
    gpuOffload: int | None = None
    cpuThreads: int | None = None
    evalBatchSize: int | None = None
    flashAttention: bool | None = None
    tryMmap: bool | None = None
    keepInMemory: bool | None = None
    offloadKvCacheToGpu: bool | None = None


@router.get("/")
async def list_models():
    models = await ai_provider.get_models()
    return {"models": models}


@router.post("/load")
async def load_model(req: LoadModelRequest):
    """Proxy to LM Studio's POST /api/v1/models/load endpoint."""
    payload: dict = {"identifier": req.model}
    if req.contextLength is not None:
        payload["context_length"] = req.contextLength
    if req.gpuOffload is not None:
        payload["gpu_offload"] = req.gpuOffload / 100  # LM Studio expects 0–1
    if req.cpuThreads is not None:
        payload["cpu_threads"] = req.cpuThreads
    if req.evalBatchSize is not None:
        payload["eval_batch_size"] = req.evalBatchSize
    if req.flashAttention is not None:
        payload["flash_attention"] = req.flashAttention
    if req.tryMmap is not None:
        payload["try_mmap"] = req.tryMmap
    if req.keepInMemory is not None:
        payload["keep_model_in_memory"] = req.keepInMemory
    if req.offloadKvCacheToGpu is not None:
        payload["offload_kv_cache_to_gpu"] = req.offloadKvCacheToGpu

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(
                f"{_LM_BASE}/api/v1/models/load",
                json=payload,
                headers={"Authorization": f"Bearer {settings.AI_API_KEY}"},
            )
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Cannot reach LM Studio. Is it running?")
