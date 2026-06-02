from fastapi import APIRouter
from fastapi.responses import StreamingResponse
import asyncio
import json

router = APIRouter()


@router.get("/")
def get_logs(limit: int = 200):
    from main import log_buffer
    entries = list(log_buffer)[-limit:]
    return {"logs": entries}


@router.get("/stream")
async def stream_logs():
    """SSE endpoint — streams new log entries as they arrive."""
    from main import log_buffer, log_subscribers

    # asyncio.Queue so we can await new entries
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    log_subscribers.append(queue)

    async def generate():
        # Send buffered history first
        for entry in list(log_buffer)[-100:]:
            yield f"data: {json.dumps(entry)}\n\n"

        try:
            while True:
                try:
                    entry = await asyncio.wait_for(queue.get(), timeout=30)
                    yield f"data: {json.dumps(entry)}\n\n"
                except asyncio.TimeoutError:
                    yield "data: {\"ping\":true}\n\n"  # keep-alive
        except asyncio.CancelledError:
            pass
        finally:
            try:
                log_subscribers.remove(queue)
            except ValueError:
                pass

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
