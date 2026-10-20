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
