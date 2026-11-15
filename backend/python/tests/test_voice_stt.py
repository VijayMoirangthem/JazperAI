from api.routes.voice import sniff_audio


def test_sniff_audio_detects_the_real_format():
    assert sniff_audio(b"\x00\x00\x00\x20ftypM4A \x00\x00")[0] == ".m4a"       # what the phone records (no file name is sent)
    assert sniff_audio(b"RIFF\x24\x00\x00\x00WAVE")[0] == ".wav"
    assert sniff_audio(bytes.fromhex("1a45dfa3") + b"\x00" * 8)[0] == ".webm"  # the browser
    assert sniff_audio(b"OggS\x00\x02\x00\x00\x00\x00")[0] == ".ogg"
    assert sniff_audio(b"ID3\x04\x00\x00\x00\x00\x00\x00")[0] == ".mp3"
    assert sniff_audio(b"????????????", "audio/wav")[0] == ".wav"               # unknown bytes: fall back to the declared type
    assert sniff_audio(b"????????????")[0] == ".webm"


async def test_speech_is_retried_and_never_returned_half_finished(monkeypatch):
    """Regression: the phone got HTTP 200 with a broken file when Microsoft's speech service dropped the stream mid-reply."""
    import edge_tts
    import pytest
    from fastapi import HTTPException

    from api.routes import voice2

    calls = {"n": 0}

    class Flaky:
        def __init__(self, text, voice):
            pass

        async def stream(self):
            calls["n"] += 1
            if calls["n"] < 3:
                yield {"type": "audio", "data": b"half"}
                raise ConnectionError("peer closed connection")
            yield {"type": "audio", "data": b"full-audio"}

    monkeypatch.setattr(edge_tts, "Communicate", Flaky)
    assert await voice2.synth_complete("hello", "en-GB-RyanNeural") == b"full-audio"    # third attempt succeeds; partial data is discarded
    assert calls["n"] == 3

    calls["n"] = -10                                                                    # keeps failing: a clear error, not a broken 200
    with pytest.raises(HTTPException) as e:
        await voice2.synth_complete("hello", "en-GB-RyanNeural", attempts=2)
    assert e.value.status_code == 502


async def test_a_stalled_speech_connection_is_cut_off_and_retried(monkeypatch):
    """Regression: one request hung for 66 s because there was no time limit on the connection to the speech service."""
    import asyncio
    import time

    import edge_tts

    from api.routes import voice2

    calls = {"n": 0}

    class Stalls:
        def __init__(self, text, voice):
            pass

        async def stream(self):
            calls["n"] += 1
            if calls["n"] == 1:
                await asyncio.sleep(30)        # the stall
            yield {"type": "audio", "data": b"ok"}

    monkeypatch.setattr(edge_tts, "Communicate", Stalls)
    t0 = time.monotonic()
    assert await voice2.synth_complete("hello", "en-GB-RyanNeural", per_attempt_s=0.3) == b"ok"
    assert time.monotonic() - t0 < 3 and calls["n"] == 2


async def test_phone_transcribe_passes_the_chosen_language_through(monkeypatch):
    """?language=hi|en forces the speech-to-text language; anything else (or nothing) means auto-detect."""
    from api.routes import remote, voice

    seen = []

    async def fake_transcribe(audio, language=None):
        seen.append(language)
        return {"text": "ok", "empty": False}

    class FakeForm(dict):
        pass

    class FakeRequest:
        async def form(self):
            return FakeForm(audio=type("A", (), {"read": lambda self: b""})())

    monkeypatch.setattr(voice, "transcribe", fake_transcribe)
    for lang in ("hi", "en", "fr", None):
        await remote.voice_transcribe(FakeRequest(), language=lang, d={"id": "x"})
    assert seen == ["hi", "en", None, None]


# ── cloud only: no local Whisper anywhere ────────────────────────────────────────────────────────────────────────────────────────

class _FakeUpload:
    def __init__(self, data: bytes, content_type: str = "audio/mp4"):
        self._d, self.content_type = data, content_type

    async def read(self):
        return self._d


def _fake_provider(monkeypatch, script):
    """A cloud provider whose transcription calls follow `script` (a list of text or Exception)."""
    from core.providers import ai_provider

    calls = {"n": 0}

    class T:
        async def create(self, **kw):
            calls["n"] += 1
            step = script.pop(0)
            if isinstance(step, Exception):
                raise step
            return type("R", (), {"text": step})()

    class P:
        client = type("C", (), {"audio": type("A", (), {"transcriptions": T()})()})()

    monkeypatch.setattr(ai_provider, "get_ai_provider", lambda: P)
    return calls


async def test_transcription_retries_once_then_succeeds(monkeypatch):
    from api.routes import voice
    calls = _fake_provider(monkeypatch, [RuntimeError("429"), "mera email dikhao"])
    assert await voice._transcribe_groq(b"x", "a.m4a", "audio/mp4") == "mera email dikhao" and calls["n"] == 2


async def test_cloud_outage_is_a_clear_503_and_nothing_runs_locally(monkeypatch):
    import pytest
    from fastapi import HTTPException

    from api.routes import voice
    calls = _fake_provider(monkeypatch, [RuntimeError("down"), RuntimeError("still down")])
    with pytest.raises(HTTPException) as e:
        await voice.transcribe(_FakeUpload(b"\x00\x00\x00\x20ftypM4A \x00\x00 audio"))
    assert e.value.status_code == 503 and "unavailable" in e.value.detail and calls["n"] == 2
    assert not hasattr(voice, "_transcribe_local") and not hasattr(voice, "_whisper_model")      # the local model path is gone


async def test_empty_audio_is_a_400_not_a_500():
    import pytest
    from fastapi import HTTPException

    from api.routes import voice
    with pytest.raises(HTTPException) as e:
        await voice.transcribe(_FakeUpload(b""))
    assert e.value.status_code == 400


async def test_transcribe_stream_sends_one_event_in_the_old_shape(monkeypatch):
    import json

    from api.routes import voice
    _fake_provider(monkeypatch, ["aaj ka status batao"])
    resp = await voice.transcribe_stream(_FakeUpload(b"\x00\x00\x00\x20ftypM4A \x00\x00 audio"))
    chunks = [c async for c in resp.body_iterator]
    assert json.loads(chunks[0].removeprefix("data: ")) == {"word": "aaj ka status batao", "full": "aaj ka status batao"} and chunks[-1] == "data: [DONE]\n\n"
