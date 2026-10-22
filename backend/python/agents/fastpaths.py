"""Deterministic fast paths for requests Jasper must never get wrong or slow, whatever model happens to be serving it.

Free/fallback models are sometimes weak (or 10 s per call). For the handful of things the founder asks all the time (Drive files, clear chat,
usage/provider, health, "make you smarter") we do not need an LLM at all: match the intent, run the real tool, and answer in one or two
lines. Everything else still goes to the normal tool loop. Events have the same shape as jasper_tools.stream_with_tools.
"""
import asyncio
import json
import re
from collections.abc import AsyncIterator

from agents import connector

Event = dict

DRIVE = re.compile(r"\b(g\s?drive|google\s?drive|drive)\b", re.I)
DRIVE_LIST = re.compile(r"\b(latest|recent|newest|last|names?|list|show|get|files?|modified)\b", re.I)
APPROVED = re.compile(r"i approved google \((drive|docs|sheets|gmail|calendar|cloud)\)", re.I)
CLEAR = re.compile(r"\b(delete|clear|wipe|remove|erase)\b.*\b(chats?|history|messages?|conversation)\b|\b(chats?|history)\b.*\b(delete|clear|wipe|remove)\b", re.I)
USAGE = re.compile(r"\b(tokens?|usage|quota|credits?|provider|which model|what model|how much)\b.*\b(left|remaining|used|using|use|usage|provider|model|spent|cost)\b|\bwhich provider\b", re.I)
HEALTH = re.compile(r"\b(system|backend|everything)\b.*\b(health|status|ok|working|running)\b|\bhealth check\b", re.I)
SMARTER = re.compile(r"\b(smarter|more powerful|more capable|upgrade you|improve you|what should i connect)\b", re.I)


def _n(text: str, default: int = 10) -> int:
    m = re.search(r"\b(\d{1,2})\b", text)
    return max(1, min(int(m.group(1)), 30)) if m else default


def _tool(name: str, label: str, status: str, result: str = "") -> Event:
    return {"tool": {"name": name, "label": label, "status": status, **({"result": result[:300]} if result else {})}}


async def _drive_list(text: str) -> AsyncIterator[Event]:
    n = _n(text)
    yield _tool("connect", "Checking Google Drive access", "running")
    st = await connector.ensure("drive")
    if st.get("request"):
        yield _tool("connect", "Checking Google Drive access", "ok", st["request"].get("reason", ""))
        yield {"ui": st["request"]}
        yield {"delta": f"One click: {st['request'].get('reason', 'approve Google access')}. Tap the button above, then I list your files right away."}
        return
    if not st.get("ok"):
        yield _tool("connect", "Checking Google Drive access", "error", str(st.get("detail", "")))
        yield {"delta": str(st.get("detail") or "Drive isn't reachable yet.")[:300]}
        return
    yield _tool("connect", "Checking Google Drive access", "ok", "verified")
    yield _tool("drive_list_recent", f"Listing your {n} latest Drive files", "running")
    from core.services import drive_service
    try:
        files = await asyncio.to_thread(drive_service.list_recent, n)
    except Exception as e:
        yield _tool("drive_list_recent", "Listing Drive files", "error", str(e))
        yield {"delta": f"Drive said no: {str(e)[:200]}"}
        return
    yield _tool("drive_list_recent", f"Listing your {n} latest Drive files", "ok", f"{len(files)} files")
    if not files:
        yield {"delta": "Your Drive has no files I can see."}
        return
    kind = {"application/vnd.google-apps.document": "Doc", "application/vnd.google-apps.spreadsheet": "Sheet", "application/vnd.google-apps.presentation": "Slides",
            "application/vnd.google-apps.folder": "Folder", "application/pdf": "PDF"}
    lines = [f"{i + 1}. {f['name']} ({kind.get(f.get('mimeType', ''), 'File')}, {str(f.get('modifiedTime', ''))[:10]})" for i, f in enumerate(files)]
    yield {"delta": f"Your {len(files)} latest Drive files:\n" + "\n".join(lines)}


async def _clear(text: str) -> AsyncIterator[Event]:
    low = text.lower()
    m = re.search(r"older than (\d+) days?", low)
    scope = f"older_than_days:{m.group(1)}" if m else "all" if (re.search(r"\b(all|whole|entire|everything)\b", low) and not re.search(r"\b(above|before|up to)\b", low)) else "before_now"
    label = {"before_now": "Delete everything above this line?", "all": "Delete this whole chat?"}.get(scope) or f"Delete messages older than {scope.split(':')[1]} days?"
    yield {"ui": {"kind": "confirm", "connector": "chat", "action": "clear_chat", "scope": scope, "label": label}}
    yield {"delta": "Tap delete to confirm (you can undo)."}


async def _usage(_: str) -> AsyncIterator[Event]:
    from agents import jasper_tools
    yield _tool("llm_status", "Checking model usage", "running")
    raw = await jasper_tools.run_tool("llm_status", {}, "jasper")
    try:
        d = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        yield {"delta": str(raw)[:400]}
        return
    yield _tool("llm_status", "Checking model usage", "ok")
    t = d["today"]
    chain = ", ".join(dict.fromkeys(d["chains"].get("standard", [])))
    top = ", ".join(f"{m['k']} ({int(m['tokens'] or 0) // 1000}k)" for m in d["by_model"][:3] if m["k"] not in ("stub", "fixed", "exact"))
    down = d.get("breaker_open_seconds_left")
    budgets = "no daily cap set" if not d.get("budgets") else "caps: " + ", ".join(f"{b['scope']} {b['daily_hard']}" for b in d["budgets"])
    yield {"delta": (f"Today: {t['calls']} calls, {(t['input_tokens'] + t['output_tokens']) // 1000}k tokens, ${t['cost_usd'] or 0:.2f}. {budgets}.\n"
                     f"Serving order: {chain}.\nTop: {top}." + (f"\nCooling down: {down}" if down else ""))}


async def _health(_: str) -> AsyncIterator[Event]:
    from agents import jasper_tools
    yield _tool("system_status", "Checking the system", "running")
    raw = await jasper_tools.run_tool("system_status", {}, "jasper")
    d = json.loads(raw) if isinstance(raw, str) else raw
    yield _tool("system_status", "Checking the system", "ok")
    bad = [f"{k}: {v}" for k, v in d["checks"].items() if v.startswith("FAIL")]
    conn = ", ".join(c["id"] for c in d["connectors"] if c["connected"]) or "none"
    yield {"delta": ("All good. " if not bad else "Problems: " + "; ".join(bad) + ". ") + f"Connected: {conn}."}


async def _smarter(_: str) -> AsyncIterator[Event]:
    items = await connector.recommendations()
    yield {"ui": {"kind": "suggestions", "items": items}}
    todo = [i for i in items if i["connectable"] and i["status"] != "connected"][:3]
    yield {"delta": "Fastest upgrades: " + "; ".join(f"{i['name']} ({i['why'].split(':')[0][:60]})" for i in todo) + ". Tap Connect on the cards."}


def match(slug: str, text: str):
    """Returns an async-generator factory for a known intent, else None. Only Jasper and Connector use fast paths."""
    if slug not in ("jasper", "connector"):
        return None
    t = text.strip()
    if len(t) > 400:
        return None
    if APPROVED.search(t) or (DRIVE.search(t) and DRIVE_LIST.search(t) and not re.search(r"\b(create|write|upload|share|delete|trash|move|rename|edit)\b", t, re.I)):
        return lambda: _drive_list(t)
    if CLEAR.search(t):
        return lambda: _clear(t)
    if USAGE.search(t):
        return lambda: _usage(t)
    if HEALTH.search(t):
        return lambda: _health(t)
    if SMARTER.search(t):
        return lambda: _smarter(t)
    return None
