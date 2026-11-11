"""Email questions are answered from the REAL mailbox, never by the model.

Why: in the team chat Jasper answered "any email from Kunal?" with invented messages (alice@example.com ...) because no tool ran. A
language model must not be the source of facts about the founder's mail. This module recognises read requests in English, Hindi
(Devanagari) and Hinglish (Roman letters), fetches the emails from Gmail, and writes the answer itself, in the user's language.
Writing, sending and deleting are NOT handled here (they fall through to the approval-gated tools).
"""
from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator
from email.utils import parsedate_to_datetime

from core.language import detect

Event = dict

_EMAIL = re.compile(r"\b(e-?mails?|inbox|gmail|mails?)\b|ईमेल|ई-मेल|मेल", re.I)
# anything that changes or sends mail, or asks for a different channel: not a read request
_ACT = re.compile(r"\b(send|write|draft|compose|reply|respond|forward|delete|trash|archive|unsubscribe|bhejo|bhej|likho|likh|jawab|delete karo|hatao)\b|भेज|लिख|जवाब|हटा", re.I)
_TODAY = re.compile(r"\b(today|aaj|latest|recent|new|newest|naye|naya|taaza|abhi|update)\b|आज|ताज़ा|नए|नया", re.I)
_UNREAD = re.compile(r"\bunread\b|\bnahi padhe\b|\bnahin padhe\b|अपठित", re.I)
_DETAIL = re.compile(r"\b(full|whole|complete|entire|poora|pura|pura email|details?|body|content|kholo|open|read)\b|पूरा|खोलो|पढ़", re.I)
_STOP = frozenset("""the my me any an a new latest recent all unread today is there are email emails mail mails inbox gmail from by give show tell update
updates check see list get fetch aaj mere mera meri kya koi ka ki ke ne se ko hai hain dikhao dikha batao bata do de kuch sab sabhi ka naye naya abhi
please pls plz jazper bhai yaar and or on about subject with full here chat window""".split())


def is_read_request(text: str) -> bool:
    """True for 'show/check/summarise my emails' style requests. False for anything that writes, sends or deletes."""
    t = text or ""
    return bool(_EMAIL.search(t)) and not _ACT.search(t)


def sender_of(text: str) -> str:
    """'from Kunal Sivach' / 'Kunal ka email' -> 'Kunal Sivach' ('' when the request names no sender)."""
    cands = []
    for m in re.finditer(r"\b(?:from|by)\s+([A-Za-z][\w.\-@]*(?:\s+[A-Za-z][\w.\-@]*)?)", text):
        cands.append(m.group(1))
    for m in re.finditer(r"\b([A-Za-z][\w.\-@]*(?:\s+[A-Za-z][\w.\-@]*)?)\s+(?:ka|ki|ke|ne|se)\s+(?:\w+\s+){0,2}(?:e-?mails?|mails?)\b", text, re.I):
        cands.append(m.group(1))
    for c in cands:
        words = [w for w in c.split() if w.lower().strip(".,?!") not in _STOP]
        name = " ".join(words).strip(".,?!")
        if len(name) >= 3:
            return name
    return ""


def build_query(text: str) -> tuple[str, str]:
    """(gmail query, sender). Words like today/aaj/latest add newer_than:1d (run() falls back to the sender's latest when that is empty)."""
    who = sender_of(text)
    parts = []
    if who:
        parts.append(f'from:"{who}"' if " " in who else f"from:{who}")
    if _UNREAD.search(text):
        parts.append("is:unread")
    if _TODAY.search(text):
        parts.append("newer_than:1d")
    return " ".join(parts), who


_T = {
    "english": {"hdr_all": "Your latest emails ({n}):", "hdr_q": "Emails matching {q} ({n}):", "none": "No emails found{q}.",
                "none_today": "No emails from {who} in the last 24 hours. Their latest:", "more": "Say 'full email from {who}' to read one completely.",
                "open": "Full email:", "amb": "Which one? Say the subject or its number."},
    "hinglish": {"hdr_all": "Aapke latest emails ({n}):", "hdr_q": "{q} wale emails ({n}):", "none": "Koi email nahi mila{q}.",
                 "none_today": "{who} ka pichle 24 ghante mein koi email nahi aaya. Unke latest:", "more": "Poora email padhne ke liye bolo 'full email from {who}'.",
                 "open": "Poora email:", "amb": "Kaun sa? Subject ya number bata do."},
    "hindi": {"hdr_all": "आपके नवीनतम ईमेल ({n}):", "hdr_q": "{q} के ईमेल ({n}):", "none": "कोई ईमेल नहीं मिला{q}।",
              "none_today": "{who} का पिछले 24 घंटे में कोई ईमेल नहीं आया। उनके नवीनतम:", "more": "पूरा ईमेल पढ़ने के लिए कहें 'full email from {who}'।",
              "open": "पूरा ईमेल:", "amb": "कौन सा? विषय या नंबर बताएं।"},
}


def _when(raw: str) -> str:
    try:
        d = parsedate_to_datetime(raw).astimezone()
        return d.strftime("%d %b %H:%M")
    except Exception:
        return (raw or "")[:16]


_INVISIBLE = dict.fromkeys(map(ord, "\u200b\u200c\u200d\u200e\u200f\u2060\u034f\u00ad\ufeff\u2007\u2800"), None)


def clean(text: str) -> str:
    """Preview text without HTML entities, zero-width/invisible characters or runs of whitespace."""
    import html
    return re.sub(r"\s+", " ", html.unescape(text or "").translate(_INVISIBLE)).strip()


def _line(i: int, e: dict) -> str:
    sender = re.sub(r"<[^>]+>", "", e.get("from", "")).strip().strip('"') or e.get("from", "?")
    snippet = clean(e.get("snippet") or "")[:110]
    return f"{i}. {sender} - {e.get('subject') or '(no subject)'} ({_when(e.get('date', ''))})" + (f"\n   {snippet}" if snippet else "")


def _tool(label: str, status: str, result: str = "") -> Event:
    return {"tool": {"name": "gmail", "label": label, "status": status, "result": result}}


async def run(text: str, history=None) -> AsyncIterator[Event]:
    from agents import fastpaths
    from api.routes import chat as chat_mod
    from core.services import gmail_service as gs

    tr = _T[detect(text)]
    query, who = build_query(text)
    inherited = False
    if not who and history:
        # a follow-up such as "display me the email here" names nobody: keep talking about the sender from the earlier message
        follow = re.search(r"\b(here|it|that|this|wo|woh|usko|ise|iska|uska)\b", text, re.I) and not _TODAY.search(text) and not _UNREAD.search(text)
        if follow:
            for h in reversed(list(history)[-6:]):
                if getattr(h, "role", "") == "user":
                    w = sender_of(str(getattr(h, "content", "")))
                    if w:
                        who, inherited = w, True
                        query = f'from:"{w}"' if " " in w else f"from:{w}"
                        break
    label = chat_mod._detect_label(text)
    detail = bool(_DETAIL.search(text)) or inherited
    yield fastpaths._tool("gmail", "Checking your inbox", "running")

    def fetch(q: str, n: int = 10) -> list[dict]:
        return gs.list_emails(max_results=n, label=label, query=q, force_refresh=True).get("emails", [])

    try:
        emails = await asyncio.to_thread(fetch, query)
        fallback = False
        if not emails and who and _TODAY.search(text):      # "any email from X today?" and there is none: show their latest, say so
            # nothing in the last 24 h: show the sender's latest WITHOUT the time limit (re-using the limited query found nothing again)
            emails, fallback = await asyncio.to_thread(fetch, query.replace(" newer_than:1d", "").replace("newer_than:1d", "").strip(), 3), True
    except Exception as e:
        yield fastpaths._tool("gmail", "Checking your inbox", "error", str(e)[:120])
        async for ev in fastpaths._google_error(e, "Gmail"):
            yield ev
        return
    yield fastpaths._tool("gmail", "Checking your inbox", "ok", f"{len(emails)} email(s)")

    if not emails:
        yield {"delta": tr["none"].format(q=(f" ({who})" if who else ""))}
        return

    if detail and who:                                        # "show me the full email from X [about Y]"
        low = text.lower()
        named = [m for m in emails if (m.get("subject") or "").strip() and m["subject"].strip().lower() in low]
        if len(named) > 1:
            top = max(len(m["subject"].strip()) for m in named)
            named = [m for m in named if len(m["subject"].strip()) == top]
        pick = named[0] if len(named) == 1 else (emails[0] if len(emails) == 1 else None)
        if pick is None and _TODAY.search(text) is None and len(emails) > 1:
            pick = emails[0]                                  # "the full email from X": the most recent one
        if pick is not None:
            body = await asyncio.to_thread(chat_mod.fetch_full_email_context, pick["id"])
            yield {"delta": f"{tr['open']}\n\n{body}"}
            return

    head = (tr["none_today"].format(who=who) if fallback else
            tr["hdr_q"].format(q=who, n=len(emails)) if who else tr["hdr_all"].format(n=len(emails)))
    out = [head, ""] + [_line(i, e) for i, e in enumerate(emails, 1)]
    if who:
        out += ["", tr["more"].format(who=who)]
    yield {"delta": "\n".join(out)}
