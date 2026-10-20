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
