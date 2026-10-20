import sys
import types

from fastapi.testclient import TestClient


def client(monkeypatch, chunks):
    fake = types.ModuleType("edge_tts")

    class Communicate:
        def __init__(self, text, voice):
            self.text, self.voice = text, voice

        async def stream(self):
            yield {"type": "WordBoundary", "offset": 0}
            for c in chunks:
                yield {"type": "audio", "data": c}

    fake.Communicate = Communicate
    monkeypatch.setitem(sys.modules, "edge_tts", fake)
    from main import app
    return TestClient(app)


def test_streams_audio_chunks_in_order_and_skips_metadata(monkeypatch):
    r = client(monkeypatch, [b"AAA", b"BBB", b"CCC"]).get("/api/v1/voice2/speak", params={"text": "Hello there."})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and r.content == b"AAABBBCCC"


def test_input_validation(monkeypatch):
    c = client(monkeypatch, [b"x"])
    assert c.get("/api/v1/voice2/speak", params={"text": "  "}).status_code == 400
    assert c.get("/api/v1/voice2/speak", params={"text": "x" * 601}).status_code == 413
    assert c.get("/api/v1/voice2/speak", params={"text": "hi", "voice": "../../etc/passwd"}).status_code == 422
