"""Voice v2 (aliased /api/v1/voice2): streaming TTS so the first sound plays before the whole sentence is synthesised.

GET /speak?text=...&voice=...  -> audio/mpeg, streamed chunk by chunk from Edge TTS (usable directly as an <audio> src).
Local Kokoro TTS was evaluated and rejected as the default: ~16 s for a short sentence on this CPU (about 12x slower than real time).
"""
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

router = APIRouter()
MAX_CHARS = 600
VOICE_RX = re.compile(r"^[A-Za-z]{2}-[A-Za-z]{2}-[A-Za-z]+Neural$")
DEFAULT_VOICE = "en-US-AriaNeural"


@router.get("/voices")
async def voices(lang: str = "en"):
    """Natural neural voices for the per-bot voice picker (Edge TTS: free, no API key, no LLM tokens). Cached for a day in Redis."""
    from core import cache

    async def load():
        import edge_tts
        out = [{"name": v["ShortName"], "gender": v["Gender"], "locale": v["Locale"], "label": v["ShortName"].split("-", 2)[-1].replace("Neural", "")}
               for v in await edge_tts.list_voices() if v["Locale"].lower().startswith(lang.lower())]
        return sorted(out, key=lambda v: (v["locale"], v["name"]))
    return {"voices": await cache.cached(f"voices:{lang}", 86400, load)}


@router.get("/speak")
async def speak(text: str, voice: str = DEFAULT_VOICE):
    text = text.strip()
    if not text:
        raise HTTPException(400, "empty text")
    if len(text) > MAX_CHARS:
        raise HTTPException(413, f"text longer than {MAX_CHARS} characters; speak sentence by sentence")
    if not VOICE_RX.match(voice):
        raise HTTPException(422, "invalid voice name")
    import edge_tts

    async def gen():
        async for chunk in edge_tts.Communicate(text, voice).stream():
            if chunk["type"] == "audio":
                yield chunk["data"]

    return StreamingResponse(gen(), media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


async def synth_complete(text: str, voice: str, attempts: int = 3, per_attempt_s: float = 6.0) -> bytes:
    """The whole audio, or an error: retries when Microsoft's speech service drops the connection (it does, occasionally).
    A streamed reply cannot be retried once the first byte is sent: the client would get a broken file with HTTP 200."""
    import asyncio

    import edge_tts
    last: Exception | None = None
    for i in range(attempts):
        async def attempt() -> bytes:
            buf = bytearray()
            async for chunk in edge_tts.Communicate(text, voice).stream():
                if chunk["type"] == "audio":
                    buf += chunk["data"]
            return bytes(buf)

        try:
            data = await asyncio.wait_for(attempt(), timeout=per_attempt_s)  # a stalled connection once held a reply for 66 s
            if data:
                return data
            last = RuntimeError("no audio received")
        except Exception as e:  # noqa: BLE001 - any failure or timeout of the remote service is retried
            last = e
        await asyncio.sleep(0.3 * (i + 1))
    raise HTTPException(502, f"speech service unavailable: {str(last)[:100]}")


@router.get("/speak-complete")
async def speak_complete(text: str, voice: str = DEFAULT_VOICE):
    """Same as /speak but returns the finished file (for the phone, which downloads it before playing) with retries."""
    from fastapi.responses import Response
    text = text.strip()
    if not text:
        raise HTTPException(400, "empty text")
    if len(text) > MAX_CHARS:
        raise HTTPException(413, f"text longer than {MAX_CHARS} characters; speak sentence by sentence")
    if not VOICE_RX.match(voice):
        raise HTTPException(422, "invalid voice name")
    return Response(await synth_complete(text, voice), media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
