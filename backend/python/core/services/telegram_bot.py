"""Two-way Telegram access to Jazper, running on this PC.

How it works: the backend long-polls Telegram's Bot API (getUpdates). Nothing is exposed to the internet: no webhook, no tunnel, no
open port; it only needs outbound HTTPS. Each message from the approved chat is sent through the same /api/chat/stream pipeline the
app uses (so email, Drive, search, agents, memory and the Hinglish/Hindi/English reply rules all work), and the answer is sent back.

Security: only ONE chat id is answered (the approved one, stored in telegram_config.chat_id). Anyone else who messages the bot gets a
one-line "private bot" reply and shows up as a pending request in the app, where you can approve them with one click. Updates are
acknowledged on receipt (at-most-once) so a restart can never replay a message that sent an email.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time

import httpx
import structlog

from core.services.telegram_service import _get_config

log = structlog.get_logger()
API = "https://api.telegram.org/bot{token}/{method}"
MAX_MSG = 4000          # Telegram's hard limit is 4096
HISTORY_TURNS = 8
HELP = ("Jazper on Telegram\n\n"
        "Just write to me like in the app - English, Hindi or Hinglish.\n"
        "Examples: 'latest emails today', 'Kunal ka email dikhao', 'mere files mein latest doc kholo', 'write a python function to ...'\n\n"
        "/new - start a fresh conversation\n/status - how Jazper is doing\n/whoami - your chat id\n/help - this message")


def split_message(text: str, limit: int = MAX_MSG) -> list[str]:
    """Split a long reply at paragraph, line or word boundaries so no chunk exceeds Telegram's limit."""
    text = (text or "").strip() or "(empty reply)"
    out: list[str] = []
    while len(text) > limit:
        cut = max(text.rfind("\n\n", 0, limit), text.rfind("\n", 0, limit), text.rfind(" ", 0, limit))
        if cut < limit // 2:
            cut = limit
        out.append(text[:cut].rstrip())
        text = text[cut:].lstrip()
    out.append(text)
    return out


def parse_stream(raw: str) -> str:
    """Join the answer tokens of an /api/chat/stream response (drops stage tags like [SEARCHING] and the usage record)."""
    parts = []
    for line in raw.split("\n"):
        if not line.startswith("data: "):
            continue
        body = line[6:]
        if re.match(r"\[[A-Z_]+\]", body) or body.startswith('{"__usage__'):
            continue
        parts.append(body)
    return "".join(parts).replace("\\n", "\n").strip()


class TelegramBot:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._offset = 0
        self._token_seen = ""
        self.username = ""
        self.last_error = ""
        self.last_update_at = 0.0
        self.pending: dict[str, dict] = {}              # chat_id -> {name, username, at}
        self._history: dict[str, list[dict]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._told_private: dict[str, float] = {}

    # ---------------------------------------------------------------- lifecycle
    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self) -> None:
        if not self.running:
            self._task = asyncio.get_running_loop().create_task(self._run(), name="telegram-bot")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
        self._task = None

    def status(self) -> dict:
        return {"running": self.running, "username": self.username, "last_error": self.last_error,
                "last_update_at": self.last_update_at or None, "pending": [{"chat_id": k, **v} for k, v in self.pending.items()]}

    # ---------------------------------------------------------------- Telegram API
    async def _call(self, client: httpx.AsyncClient, token: str, method: str, **payload) -> dict:
        r = await client.post(API.format(token=token, method=method), json=payload, timeout=payload.get("timeout", 10) + 15)
        data = r.json()
        if not data.get("ok"):
            raise RuntimeError(f"{method}: {data.get('description', r.status_code)}")
        return data["result"]

    async def _send(self, client, token, chat_id: str, text: str) -> None:
        for chunk in split_message(text):
            try:
                await self._call(client, token, "sendMessage", chat_id=chat_id, text=chunk)  # plain text: no Markdown parse failures
            except Exception as e:
                log.warning("telegram send failed", error=str(e)[:120])

    # ---------------------------------------------------------------- main loop
    async def _run(self) -> None:
        backoff = 2
        async with httpx.AsyncClient() as client:
            while True:
                token, chat_id, enabled = await asyncio.to_thread(_get_config)
                if not token or not enabled:
                    self.last_error = "" if not token else "disabled"
                    await asyncio.sleep(15)
                    continue
                if token != self._token_seen:
                    self._token_seen, self._offset, self.username = token, 0, ""
                    try:
                        me = await self._call(client, token, "getMe")
                        self.username = me.get("username", "")
                        log.info("telegram bot connected", username=self.username)
                    except Exception as e:
                        self.last_error = str(e)[:160]
                        self._token_seen = ""
                        await asyncio.sleep(min(backoff, 60)); backoff = min(backoff * 2, 60)
                        continue
                try:
                    updates = await self._call(client, token, "getUpdates", offset=self._offset, timeout=25, allowed_updates=["message"])
                    backoff, self.last_error = 2, ""
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    self.last_error = str(e)[:160]
                    await asyncio.sleep(min(backoff, 60)); backoff = min(backoff * 2, 60)
                    continue
                for u in updates:
                    self._offset = max(self._offset, u["update_id"] + 1)   # acknowledge first: at-most-once
                    self.last_update_at = time.time()
                    m = u.get("message") or {}
                    if m.get("text") and m.get("chat", {}).get("type") == "private":
                        asyncio.create_task(self._handle(client, token, chat_id, m))

    # ---------------------------------------------------------------- one message
    async def _handle(self, client, token: str, owner: str, m: dict) -> None:
        cid, text = str(m["chat"]["id"]), m["text"].strip()
        who = m.get("from", {})
        if not owner or cid != owner:
            name = " ".join(x for x in (who.get("first_name"), who.get("last_name")) if x) or "unknown"
            self.pending[cid] = {"name": name, "username": who.get("username", ""), "at": time.time()}
            if time.time() - self._told_private.get(cid, 0) > 600:
                self._told_private[cid] = time.time()
                await self._send(client, token, cid, f"Hi {name}. This is a private assistant. I've asked its owner to approve you.\nYour chat id: {cid}")
            return
        self.pending.pop(cid, None)
        lock = self._locks.setdefault(cid, asyncio.Lock())
        async with lock:                                   # one conversation turn at a time, in order
            cmd = text.split()[0].lower().split("@")[0] if text.startswith("/") else ""
            if cmd in ("/start", "/help"):
                return await self._send(client, token, cid, HELP)
            if cmd == "/new":
                self._history.pop(cid, None)
                return await self._send(client, token, cid, "Fresh start. What next?")
            if cmd == "/whoami":
                return await self._send(client, token, cid, f"chat id {cid}")
            if cmd == "/status":
                return await self._send(client, token, cid, await self._status_text())
            await self._ask(client, token, cid, text[:4000])

    async def _status_text(self) -> str:
        try:
            from core.perf import monitor
            s = await monitor.status()
            w = ("\nWarnings: " + "; ".join(s["warnings"])) if s["warnings"] else ""
            return (f"Jazper is up. {s['agents']['active']}/{s['agents']['total']} agents active, {s['rss_mb']:.0f} MB RAM, "
                    f"{s['cpu_pct_one_core']:.0f}% CPU, {s['tasks']['agent']['running']} task(s) running." + w)
        except Exception as e:
            return f"Jazper is up, but the monitor failed: {str(e)[:100]}"

    async def _ask(self, client, token: str, cid: str, text: str) -> None:
        typing = asyncio.create_task(self._typing(client, token, cid))
        try:
            hist = self._history.setdefault(cid, [])
            base = os.getenv("JAZPER_API_URL", "http://127.0.0.1:8000")
            async with httpx.AsyncClient(timeout=180) as api:
                r = await api.post(f"{base}/api/chat/stream", json={"message": text, "history": hist[-HISTORY_TURNS:], "sessionId": f"telegram-{cid}",
                                                                      "sessionMode": "permanent"})
                reply = parse_stream(r.text) if r.status_code == 200 else f"Jazper hit an error ({r.status_code}). Try again in a moment."
            hist += [{"role": "user", "content": text}, {"role": "assistant", "content": reply}]
            del hist[:-HISTORY_TURNS * 2]
        except Exception as e:
            log.warning("telegram ask failed", error=str(e)[:160])
            reply = "Sorry, I couldn't reach Jazper's brain just now. Please try again."
        finally:
            typing.cancel()
        await self._send(client, token, cid, reply)

    async def _typing(self, client, token: str, cid: str) -> None:
        try:
            while True:
                try:
                    await self._call(client, token, "sendChatAction", chat_id=cid, action="typing")
                except Exception:
                    pass
                await asyncio.sleep(4)
        except asyncio.CancelledError:
            pass


bot = TelegramBot()
