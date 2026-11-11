"""Two-way Telegram: only the approved chat is answered; strangers go to a pending list; long replies are split."""
import pytest

from core.services import telegram_bot as tb


def msg(chat, text, name="Vijay"):
    return {"chat": {"id": chat, "type": "private"}, "text": text, "from": {"first_name": name, "username": "u"}}


@pytest.fixture
def bot(monkeypatch):
    b = tb.TelegramBot()
    sent, asked = [], []

    async def fake_send(client, token, chat_id, text):
        sent.append((chat_id, text))

    async def fake_ask(client, token, cid, text):
        asked.append((cid, text))
        await fake_send(None, token, cid, f"echo:{text}")
    monkeypatch.setattr(b, "_send", fake_send)
    monkeypatch.setattr(b, "_ask", fake_ask)
    b.sent, b.asked = sent, asked
    return b


async def test_approved_chat_is_answered(bot):
    await bot._handle(None, "tok", "111", msg(111, "latest emails today"))
    assert bot.asked == [("111", "latest emails today")] and bot.sent[-1] == ("111", "echo:latest emails today")
    assert bot.pending == {}


async def test_stranger_is_never_answered_and_becomes_pending(bot):
    await bot._handle(None, "tok", "111", msg(999, "show me all emails", name="Eve"))
    assert bot.asked == []                                          # Jazper's brain was never called
    assert "private assistant" in bot.sent[0][1] and bot.sent[0][0] == "999"
    assert bot.pending["999"]["name"] == "Eve"
    await bot._handle(None, "tok", "111", msg(999, "hello?", name="Eve"))
    assert len(bot.sent) == 1                                       # no spam: one notice per 10 minutes


async def test_no_owner_configured_means_everyone_is_pending(bot):
    await bot._handle(None, "tok", "", msg(5, "/start"))
    assert bot.asked == [] and "5" in bot.pending


async def test_commands_do_not_reach_the_ai(bot, monkeypatch):
    async def fake_status():
        return "up"
    monkeypatch.setattr(bot, "_status_text", fake_status)
    for c in ("/help", "/start", "/whoami", "/status", "/new"):
        await bot._handle(None, "tok", "111", msg(111, c))
    assert bot.asked == [] and len(bot.sent) == 5
    assert "English, Hindi or Hinglish" in bot.sent[0][1] and bot.sent[2][1] == "chat id 111" and bot.sent[3][1] == "up"
    await bot._handle(None, "tok", "111", msg(111, "/help@JazperBot"))   # group-style command suffix still works
    assert bot.asked == []


def test_long_replies_are_split_under_the_limit_without_losing_text():
    text = ("word " * 30 + "\n\n") * 80
    parts = tb.split_message(text, limit=500)
    assert all(len(p) <= 500 for p in parts) and len(parts) > 3
    assert "".join(parts).replace(" ", "").replace("\n", "") == text.replace(" ", "").replace("\n", "")
    assert tb.split_message("") == ["(empty reply)"] and tb.split_message("hi") == ["hi"]
    assert all(len(p) <= 100 for p in tb.split_message("x" * 1000, limit=100))     # no spaces at all: hard cut


def test_stream_parsing_keeps_answer_tokens_only():
    nl, bs = chr(10), chr(92)
    sep = nl + nl                                    # SSE events are separated by a blank line
    lines = ['data: [SEARCHING]"Searching Inbox"', "data: [SEARCHING_DONE]", "data: Hello ",
             "data: [link](http://x) world" + bs + "nline2", 'data: [META]{"duration_ms": 5}',
             'data: {"__usage__": {"total": 3}}', "data: [DONE]"]
    raw = sep.join(lines) + nl
    assert tb.parse_stream(raw) == "Hello [link](http://x) world" + nl + "line2"


async def test_ask_sends_history_session_and_returns_parsed_reply(monkeypatch):
    """_ask talks to the local chat API (faked) with a per-chat session and rolling history; failures give a polite message."""
    calls = []

    class FakeResp:
        status_code = 200
        text = 'data: Namaste\n\ndata: [DONE]\n'

    class FakeApi:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, json=None):
            calls.append((url, json)); return FakeResp()
    monkeypatch.setattr(tb.httpx, "AsyncClient", FakeApi)
    b = tb.TelegramBot()
    out = []

    async def fake_send(client, token, chat_id, text): out.append(text)

    async def fake_typing(*a): return None
    monkeypatch.setattr(b, "_send", fake_send); monkeypatch.setattr(b, "_typing", fake_typing)
    await b._ask(None, "tok", "7", "kya haal hai")
    await b._ask(None, "tok", "7", "second")
    assert out == ["Namaste", "Namaste"]
    assert calls[0][1]["sessionId"] == "telegram-7" and calls[0][1]["history"] == []
    assert [h["content"] for h in calls[1][1]["history"]] == ["kya haal hai", "Namaste"]      # rolling history is passed on


async def test_ask_failure_is_polite_not_a_crash(monkeypatch):
    class Boom:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): raise ConnectionError("down")
        async def __aexit__(self, *a): return False
    monkeypatch.setattr(tb.httpx, "AsyncClient", Boom)
    b = tb.TelegramBot(); out = []

    async def fake_send(client, token, chat_id, text): out.append(text)

    async def fake_typing(*a): return None
    monkeypatch.setattr(b, "_send", fake_send); monkeypatch.setattr(b, "_typing", fake_typing)
    await b._ask(None, "tok", "7", "hi")
    assert "couldn't reach Jazper" in out[0]


async def test_polling_loop_end_to_end_against_a_fake_telegram(monkeypatch):
    """The real _run loop: getMe, getUpdates (long poll), acknowledge by offset, answer the approved chat, ignore the stranger."""
    import asyncio
    import json as _json
    import httpx

    sent, offsets = [], []
    queue = [[{"update_id": 10, "message": msg(111, "hello jazper")}, {"update_id": 11, "message": msg(222, "let me in", name="Eve")}], []]

    def handler(request: httpx.Request) -> httpx.Response:
        method = request.url.path.rsplit("/", 1)[-1]
        body = _json.loads(request.content or b"{}")
        if method == "getMe":
            return httpx.Response(200, json={"ok": True, "result": {"username": "JazperTestBot"}})
        if method == "getUpdates":
            offsets.append(body["offset"])
            return httpx.Response(200, json={"ok": True, "result": queue.pop(0) if queue else []})
        if method == "sendMessage":
            sent.append((body["chat_id"], body["text"]))
        return httpx.Response(200, json={"ok": True, "result": {}})

    real = httpx.AsyncClient
    monkeypatch.setattr(tb.httpx, "AsyncClient", lambda *a, **k: real(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(tb, "_get_config", lambda: ("123:token", "111", True))
    b = tb.TelegramBot()

    async def fake_ask(client, token, cid, text):
        await b._send(client, token, cid, "reply:" + text)
    monkeypatch.setattr(b, "_ask", fake_ask)
    b.start()
    for _ in range(60):
        if len(sent) >= 2:
            break
        await asyncio.sleep(0.05)
    await b.stop()
    assert b.username == "JazperTestBot"
    assert ("111", "reply:hello jazper") in sent                      # the approved chat got an answer
    assert any(c == "222" and "private assistant" in t for c, t in sent)   # the stranger only got the private notice
    assert not any(c == "222" and t.startswith("reply:") for c, t in sent)
    assert offsets[0] == 0 and offsets[1] == 12                       # updates acknowledged: next poll starts after the last one
    assert "222" in b.pending and not b.running
