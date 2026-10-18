from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
from concurrent.futures import ThreadPoolExecutor
import tempfile
import os
import asyncio
import json
import re
import base64
import uuid
import structlog

router = APIRouter()
log = structlog.get_logger()

# ── Transcription backend ─────────────────────────────────────────────────────
# Primary:  Groq whisper-large-v3-turbo (~150 ms, no local GPU/thread issues)
# Fallback: faster-whisper tiny.en on CPU (used if Groq call fails)

_whisper_model = None
_whisper_lock  = asyncio.Lock()  # prevent concurrent model downloads


async def _transcribe_groq(audio_bytes: bytes, filename: str, mime: str) -> str | None:
    """Call Groq's Whisper API. Returns text or None on failure."""
    try:
        from app.providers.ai_provider import get_ai_provider
        provider = get_ai_provider()
        result = await provider.client.audio.transcriptions.create(
            model="whisper-large-v3-turbo",
            file=(filename, audio_bytes, mime),
            response_format="json",
            language="en",
        )
        return (result.text or "").strip()
    except Exception as exc:
        log.warning("Groq transcription failed, falling back to local Whisper", error=str(exc))
        return None


async def _transcribe_local(audio_bytes: bytes, suffix: str) -> str:
    """Fallback: faster-whisper tiny.en on CPU."""
    global _whisper_model
    async with _whisper_lock:
        if _whisper_model is None:
            from faster_whisper import WhisperModel
            log.info("Loading Whisper tiny.en model (fallback)...")
            _whisper_model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
            log.info("Whisper ready")

    loop = asyncio.get_event_loop()

    def _run():
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(audio_bytes)
            tmp = f.name
        try:
            segs, _ = _whisper_model.transcribe(
                tmp, language="en", beam_size=1,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 300},
            )
            return " ".join(s.text.strip() for s in segs).strip()
        finally:
            os.unlink(tmp)

    return await loop.run_in_executor(None, _run)


class SpeakRequest(BaseModel):
    text: str
    voice: str = "en-US-AriaNeural"  # Natural female voice


@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """
    Transcribe audio using Groq whisper-large-v3-turbo (~150 ms).
    Falls back to local faster-whisper tiny.en if Groq is unavailable.
    """
    try:
        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio")

        is_wav   = (audio.content_type or "").endswith("wav")
        filename = "audio.wav" if is_wav else "audio.webm"
        mime     = "audio/wav"  if is_wav else "audio/webm"
        suffix   = ".wav"       if is_wav else ".webm"

        # Try Groq first (fast), then local fallback
        text = await _transcribe_groq(audio_bytes, filename, mime)
        if text is None:
            text = await _transcribe_local(audio_bytes, suffix)

        log.info("Transcribed", text=text[:60])

        if not text:
            return {"text": "", "empty": True}

        # Detect voice-triggered workflows (zero cost — pure regex)
        from app.services.workflow_service import detect_workflow
        matched  = detect_workflow(text)
        workflow = None
        if matched:
            workflow = {
                "id":             matched["id"],
                "name":           matched["name"],
                "needs_approval": matched["approval"] is not None,
            }

        return {"text": text, "empty": False, "workflow": workflow}

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
            global _whisper_model
            if _whisper_model is None:
                from faster_whisper import WhisperModel
                _whisper_model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
            segments, _ = _whisper_model.transcribe(
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


class CommandRequest(BaseModel):
    text: str
    speak: bool = True          # whether to also return TTS audio
    voice: str = "en-US-AriaNeural"


# Navigation keyword map — checked before LLM to keep latency near-zero
_NAV_KEYWORDS: list[tuple[list[str], str]] = [
    (["dashboard", "home", "overview"],            "dashboard"),
    (["chat", "talk", "message", "send"],          "chat"),
    (["task", "tasks", "todo", "to-do", "to do"],  "tasks"),
    (["job", "jobs", "apply", "application"],      "jobs"),
    (["setting", "settings", "config", "preference"], "settings"),
    (["control tower", "tower", "processes", "system"], "control-tower"),
    (["it department", "darwin", "repair", "self-repair", "observatory"], "it_dept"),
    (["notification", "notifications", "alerts"],  "notifications"),
]

# Short prefixes that signal navigation intent
_NAV_PREFIXES = [
    "go to ", "open ", "show me ", "navigate to ", "take me to ",
    "switch to ", "bring up ", "launch ", "view ",
]


def _detect_navigation(text: str) -> str | None:
    lower = text.lower().strip()
    # Check if it sounds like navigation
    is_nav = any(lower.startswith(p) for p in _NAV_PREFIXES)
    if not is_nav:
        # Short utterances (≤5 words) that match a panel name exactly
        is_nav = len(lower.split()) <= 5
    if not is_nav:
        return None
    for keywords, panel in _NAV_KEYWORDS:
        if any(kw in lower for kw in keywords):
            return panel
    return None


@router.post("/command")
async def voice_command(body: CommandRequest):
    """
    Central voice command dispatcher.

    Returns one of:
      { type: "navigate", target: "<panel>" }           — pure navigation
      { type: "chat",    response: str, audio?: bytes } — question/command routed to LLM
    """
    text = body.text.strip()
    if not text:
        return {"type": "empty"}

    # 1. Navigation intent check (no LLM needed)
    nav_target = _detect_navigation(text)
    if nav_target:
        log.info("Voice: navigation intent", text=text, target=nav_target)
        return {"type": "navigate", "target": nav_target}

    # 2. Route to LLM for a concise, spoken-word optimised answer
    log.info("Voice: chat intent", text=text[:80])
    try:
        from app.providers.ai_provider import get_ai_provider
        provider = get_ai_provider()
        spoken_system = (
            "You are Jazper, a voice assistant. "
            "Give SHORT answers — 1-2 sentences max. "
            "No markdown, no lists, no code blocks. Plain spoken English only."
        )
        result = await provider.chat(
            messages=[
                {"role": "system", "content": spoken_system},
                {"role": "user", "content": text},
            ],
            max_tokens=120,
            temperature=0.5,
        )
        response_text = result.content
    except Exception as exc:
        log.error("Voice command LLM failed", error=str(exc))
        response_text = "Sorry, I couldn't process that right now."

    result: dict = {"type": "chat", "response": response_text}

    # 3. Optionally generate TTS audio and return as base64
    if body.speak and response_text:
        try:
            import base64
            import edge_tts
            communicate = edge_tts.Communicate(response_text, body.voice)
            audio_chunks: list[bytes] = []
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_chunks.append(chunk["data"])
            if audio_chunks:
                result["audio_b64"] = base64.b64encode(b"".join(audio_chunks)).decode()
        except Exception as exc:
            log.warning("Voice command TTS failed (non-fatal)", error=str(exc))

    return result


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


# ── Conversation mode ─────────────────────────────────────────────────────────

# Tracks in-flight converse streams so /converse/cancel can interrupt them.
_active_converse: dict[str, asyncio.Event] = {}

# Jazper's voice personality in spoken conversation mode.
_SPOKEN_JAZPER_SYSTEM = (
    "You are Jazper — VJ's personal AI assistant, best friend, and strategic advisor. "
    "You are witty, sharp, warm, and proactive. "
    "You are speaking ALOUD — reply in 1 to 3 short, natural sentences. "
    "Absolutely no markdown, no bullet points, no code blocks, no headers. "
    "Plain spoken English only. Be concise, human, and direct — like talking to a close friend."
)

# Matches a sentence boundary: ./?/! optionally followed by closing quote/bracket,
# then one or more whitespace characters.
_SENTENCE_END_RE = re.compile(r'[.!?]["\')]?\s+')

# ── Voice chain detection ─────────────────────────────────────────────────────

_VOICE_CHAIN_SIGNALS = (
    "and then", "after that", "after which",
    "then reply", "then send", "then apply", "then create", "then delete",
    "then schedule", "then forward", "then confirm",
    "and apply", "and send", "and reply", "and forward",
    "and create", "and delete", "and schedule", "and add",
    "if found", "if available", "if free", "if i have",
    "if there is", "if it says", "if yes", "if so,", "if not,",
    "first find", "first check", "first read", "first search",
    "step by step", "one by one",
)

_VOICE_EXECUTOR = ThreadPoolExecutor(max_workers=2)


def _is_voice_chain(text: str) -> bool:
    if len(text.split()) <= 5:
        return False
    lower = text.lower()
    return any(s in lower for s in _VOICE_CHAIN_SIGNALS)


async def _voice_chain_stream(
    text: str,
    history: list[dict],
    voice: str,
    conv_id: str,
    cancel_event: asyncio.Event,
):
    """
    Route a voice message through the chain loop.
    Yields SSE frames — passes chain plan/step events through directly,
    and TTS-wraps key moments so the user hears what is happening.
    """
    from app.routes.chain_loop import run_chain_loop
    from app.core.config import settings

    loop = asyncio.get_running_loop()

    full_result = ""
    seq = 0

    try:
        async for raw in run_chain_loop(
            message=text,
            session_id=conv_id,
            history=history,
            executor=_VOICE_EXECUTOR,
            loop=loop,
            resolved_email=None,
            user_profile=None,
            core_memories=None,
            model=None,
        ):
            if cancel_event.is_set():
                break

            # Skip internal usage sentinels
            if isinstance(raw, str) and raw.startswith('{"__usage__"'):
                continue

            if not isinstance(raw, str) or not raw.startswith("data: "):
                continue

            payload = raw[6:].strip()

            # ── Chain plan: announce and pass through ──────────────────────────
            if payload.startswith("[CHAIN_PLAN]"):
                yield raw  # forward for UI
                try:
                    data = json.loads(payload[12:])
                    steps = data.get("steps", [])
                    if steps:
                        announcement = "Alright, here's my plan. " + ". ".join(
                            f"Step {i+1}: {s}" for i, s in enumerate(steps[:3])
                        )
                        audio = await _tts_b64(announcement[:400], voice)
                        if audio:
                            yield f"data: [SENTENCE]{json.dumps({'seq': seq, 'text': announcement, 'audio_b64': audio})}\n\n"
                            seq += 1
                except Exception:
                    pass

            # ── Chain step: pass through; TTS completions ──────────────────────
            elif payload.startswith("[CHAIN_STEP]"):
                yield raw  # forward for UI
                try:
                    data = json.loads(payload[12:])
                    if data.get("status") == "done" and data.get("result"):
                        result_preview = str(data["result"])[:200]
                        audio = await _tts_b64(result_preview, voice)
                        if audio:
                            yield f"data: [SENTENCE]{json.dumps({'seq': seq, 'text': result_preview, 'audio_b64': audio})}\n\n"
                            seq += 1
                except Exception:
                    pass

            # ── Approval gate: TTS the request ────────────────────────────────
            elif payload.startswith("[APPROVAL_NEEDED]"):
                yield raw  # forward for UI (shows approval overlay)
                try:
                    data = json.loads(payload[17:])
                    msg = data.get("message", "I need your approval to proceed. Tap the approve button to continue.")
                    audio = await _tts_b64(msg[:300], voice)
                    if audio:
                        yield f"data: [SENTENCE]{json.dumps({'seq': seq, 'text': msg, 'audio_b64': audio})}\n\n"
                        seq += 1
                except Exception:
                    pass

            # ── Chain done: TTS final result, emit [DONE] ─────────────────────
            elif payload.startswith("[CHAIN_DONE]"):
                try:
                    data = json.loads(payload[12:])
                    summary = data.get("summary", "")
                    if summary:
                        full_result = summary
                        audio = await _tts_b64(summary[:400], voice)
                        if audio:
                            yield f"data: [SENTENCE]{json.dumps({'seq': seq, 'text': summary, 'audio_b64': audio})}\n\n"
                            seq += 1
                except Exception:
                    pass
                yield f"data: [DONE]{json.dumps({'full_text': full_result, 'conv_id': conv_id})}\n\n"

            # ── Chain error: TTS and emit [ERROR] ─────────────────────────────
            elif payload.startswith("[CHAIN_ERROR]"):
                try:
                    data = json.loads(payload[13:])
                    err_text = data.get("message", "Something went wrong while executing that task.")
                    audio = await _tts_b64(err_text[:200], voice)
                    if audio:
                        yield f"data: [SENTENCE]{json.dumps({'seq': seq, 'text': err_text, 'audio_b64': audio})}\n\n"
                        seq += 1
                except Exception:
                    pass
                yield f"data: [ERROR]{json.dumps({'error': 'Chain execution failed'})}\n\n"

            # Pass anything else through unchanged
            else:
                yield raw

    except Exception as exc:
        log.error("voice/chain error", error=str(exc))
        err_msg = "I ran into an unexpected error. Please try again."
        try:
            audio = await _tts_b64(err_msg, voice)
            if audio:
                yield f"data: [SENTENCE]{json.dumps({'seq': seq, 'text': err_msg, 'audio_b64': audio})}\n\n"
        except Exception:
            pass
        yield f"data: [ERROR]{json.dumps({'error': str(exc)})}\n\n"


async def _tts_b64(text: str, voice: str) -> str:
    """TTS a single sentence and return it as a base64-encoded MP3 string."""
    import edge_tts
    comm = edge_tts.Communicate(text.strip(), voice)
    chunks: list[bytes] = []
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])
    if not chunks:
        return ""
    return base64.b64encode(b"".join(chunks)).decode()


class ConverseRequest(BaseModel):
    text: str
    history: list[dict] = []          # [{role: "user"|"assistant", content: str}]
    voice: str = "en-US-GuyNeural"    # default: male Jazper voice
    conv_id: str = ""


class CancelRequest(BaseModel):
    conv_id: str


@router.post("/converse")
async def converse(body: ConverseRequest):
    """
    Streaming voice conversation endpoint.

    Streams Jazper's reply sentence-by-sentence. Each complete sentence's TTS
    starts immediately as a background task (parallel prefetch), so sentence N+1's
    audio generates while N is still playing on the frontend.

    SSE frames:
      data: [SENTENCE]{"seq": 0, "text": "...", "audio_b64": "..."}
      data: [DONE]{"full_text": "...", "conv_id": "..."}
      data: [CANCELLED]
      data: [ERROR]{"error": "..."}
    """
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")

    conv_id = body.conv_id or str(uuid.uuid4())
    cancel_event = asyncio.Event()
    _active_converse[conv_id] = cancel_event

    async def generate():
        try:
            # ── Phase 8D: route multi-step commands through chain loop ─────────
            if _is_voice_chain(body.text):
                history_msgs = [
                    {"role": h["role"], "content": str(h.get("content", ""))}
                    for h in (body.history or [])[-20:]
                    if isinstance(h, dict) and h.get("role") in ("user", "assistant")
                ]
                async for frame in _voice_chain_stream(
                    body.text, history_msgs, body.voice, conv_id, cancel_event
                ):
                    yield frame
                return

            from app.providers.ai_provider import get_ai_provider
            provider = get_ai_provider()

            messages: list[dict] = [{"role": "system", "content": _SPOKEN_JAZPER_SYSTEM}]
            for h in (body.history or [])[-20:]:
                if isinstance(h, dict) and h.get("role") in ("user", "assistant"):
                    messages.append({"role": h["role"], "content": str(h.get("content", ""))})
            messages.append({"role": "user", "content": body.text})

            stream = await provider.client.chat.completions.create(
                model=provider.default_model,
                messages=messages,
                stream=True,
                max_tokens=250,
                temperature=0.75,
            )

            sentence_buf = ""
            full_text = ""
            seq = 0
            # TTS tasks start as soon as each sentence's text is ready.
            # We yield them in order as they complete (first-in-first-out).
            pending: list[tuple[int, str, asyncio.Task]] = []

            async for chunk in stream:
                if cancel_event.is_set():
                    break
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta.content
                if not delta:
                    continue

                sentence_buf += delta
                full_text    += delta

                # Detect sentence boundaries and launch TTS immediately
                while True:
                    m = _SENTENCE_END_RE.search(sentence_buf)
                    if not m or m.end() >= len(sentence_buf):
                        break
                    to_speak     = sentence_buf[: m.end()].strip()
                    sentence_buf = sentence_buf[m.end():]
                    if to_speak and not cancel_event.is_set():
                        task = asyncio.create_task(_tts_b64(to_speak, body.voice))
                        pending.append((seq, to_speak, task))
                        seq += 1

                # Yield any TTS tasks that finished while the LLM was streaming
                while pending and pending[0][2].done() and not cancel_event.is_set():
                    s_num, s_text, task = pending.pop(0)
                    try:
                        audio_b64 = task.result()
                    except Exception as tts_err:
                        log.warning("TTS task failed", seq=s_num, error=str(tts_err))
                        audio_b64 = ""
                    if audio_b64:
                        yield f"data: [SENTENCE]{json.dumps({'seq': s_num, 'text': s_text, 'audio_b64': audio_b64})}\n\n"

            # Flush remaining buffer as the last sentence
            remaining = sentence_buf.strip()
            if remaining and not cancel_event.is_set():
                task = asyncio.create_task(_tts_b64(remaining, body.voice))
                pending.append((seq, remaining, task))

            # Drain the pending queue — await each in order so they come out sequentially
            while pending and not cancel_event.is_set():
                s_num, s_text, task = pending.pop(0)
                try:
                    audio_b64 = await task
                except Exception as tts_err:
                    log.warning("TTS task failed", seq=s_num, error=str(tts_err))
                    audio_b64 = ""
                if audio_b64:
                    yield f"data: [SENTENCE]{json.dumps({'seq': s_num, 'text': s_text, 'audio_b64': audio_b64})}\n\n"

            if cancel_event.is_set():
                yield "data: [CANCELLED]\n\n"
            else:
                yield f"data: [DONE]{json.dumps({'full_text': full_text.strip(), 'conv_id': conv_id})}\n\n"

        except Exception as exc:
            log.error("voice/converse error", error=str(exc))
            yield f"data: [ERROR]{json.dumps({'error': str(exc)})}\n\n"
        finally:
            _active_converse.pop(conv_id, None)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@router.post("/converse/cancel")
async def cancel_converse(body: CancelRequest):
    """Signal an in-flight /converse stream to stop generating."""
    evt = _active_converse.get(body.conv_id)
    if evt:
        evt.set()
        return {"cancelled": True}
    return {"cancelled": False}
