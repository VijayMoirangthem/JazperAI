from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
import tempfile
import os
import asyncio
import json
import structlog

router = APIRouter()
log = structlog.get_logger()

_whisper_model = None


def _get_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        log.info("Loading Whisper base model...")
        # CPU inference, base model — fast enough for push-to-talk
        _whisper_model = WhisperModel("small", device="cpu", compute_type="int8")
        log.info("Whisper ready")
    return _whisper_model


class SpeakRequest(BaseModel):
    text: str
    voice: str = "en-US-AriaNeural"  # Natural female voice


@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """Receive audio blob (WAV/WebM), transcribe with Whisper, return text."""
    try:
        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio")

        loop = asyncio.get_event_loop()

        def _run():
            suffix = ".wav" if audio.content_type == "audio/wav" else ".webm"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                f.write(audio_bytes)
                tmp_path = f.name
            try:
                model = _get_whisper()
                segments, info = model.transcribe(
                    tmp_path,
                    language="en",
                    beam_size=5,
                    vad_filter=True,          # built-in VAD to skip silence
                    vad_parameters={"min_silence_duration_ms": 500},
                )
                text = " ".join(s.text.strip() for s in segments).strip()
                log.info("Transcribed", lang=info.language, text=text[:60])
                return text
            finally:
                os.unlink(tmp_path)

        text = await loop.run_in_executor(None, _run)

        if not text:
            return {"text": "", "empty": True}
        return {"text": text, "empty": False}

    except Exception as e:
        log.error("Transcription failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transcribe-stream")
async def transcribe_stream(audio: UploadFile = File(...)):
    """Transcribe audio and stream each Whisper segment via SSE as it's processed."""
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio")

    suffix = ".wav" if (audio.content_type or "").endswith("wav") else ".webm"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.write(audio_bytes)
    tmp.close()

    async def generate():
        loop = asyncio.get_event_loop()
        full_text = ""

        def _iter_segments():
            model = _get_whisper()
            segments, _ = model.transcribe(
                tmp.name,
                language="en",
                beam_size=3,           # faster beam for streaming feel
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 300},
            )
            return list(segments)     # materialise generator in thread

        try:
            segments = await loop.run_in_executor(None, _iter_segments)
            for seg in segments:
                word = seg.text.strip()
                if word:
                    full_text = (full_text + " " + word).strip()
                    payload = json.dumps({"word": word, "full": full_text})
                    yield f"data: {payload}\n\n"
                    await asyncio.sleep(0)  # let event loop breathe between segments
        finally:
            os.unlink(tmp.name)

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@router.post("/speak")
async def speak(body: SpeakRequest):
    """Convert text to speech using Edge TTS, return complete MP3."""
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")

    import edge_tts
    communicate = edge_tts.Communicate(body.text, body.voice)
    audio_chunks: list[bytes] = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_chunks.append(chunk["data"])

    if not audio_chunks:
        raise HTTPException(status_code=500, detail=f"No audio generated for voice {body.voice!r}")

    return Response(
        content=b"".join(audio_chunks),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/voices")
async def list_voices():
    """Return available Edge TTS voices."""
    import edge_tts
    voices = await edge_tts.list_voices()
    en_voices = [
        {"name": v["Name"], "short": v["ShortName"], "gender": v["Gender"]}
        for v in voices if v["Locale"].startswith("en-")
    ]
    return {"voices": en_voices}
