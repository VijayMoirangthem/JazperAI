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
