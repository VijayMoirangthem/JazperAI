from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import structlog
import json
import time
from concurrent.futures import ThreadPoolExecutor

from app.providers.ai_provider import ai_provider
from app.services.memory_service import memory_service
from app.services.search_service import WEB_SEARCH_TOOL, run_search, should_search

# ── Gmail tool definitions (OpenAI tool-call format) ──────────────────────────
GMAIL_READ_TOOL = {
    "type": "function",
    "function": {
        "name": "read_email",
        "description": "Fetch latest emails from Gmail inbox.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Gmail search filter. Empty = latest inbox."},
                "limit": {"type": "integer", "description": "How many emails (1-10, default 5)."},
            },
            "required": [],
        },
    },
}

GMAIL_SEND_TOOL = {
    "type": "function",
    "function": {
        "name": "send_email",
        "description": "Send an email.",
        "parameters": {
            "type": "object",
            "properties": {
                "to": {"type": "string"},
                "subject": {"type": "string"},
                "body": {"type": "string"},
                "reply_to_id": {"type": "string"},
            },
            "required": ["to", "subject", "body"],
        },
    },
}

GMAIL_DELETE_TOOL = {
    "type": "function",
    "function": {
        "name": "trash_email",
        "description": "Move email to trash.",
        "parameters": {
            "type": "object",
            "properties": {"msg_id": {"type": "string"}},
            "required": ["msg_id"],
        },
    },
}

GMAIL_ARCHIVE_TOOL = {
    "type": "function",
    "function": {
        "name": "archive_email",
        "description": "Archive email (remove from inbox).",
        "parameters": {
            "type": "object",
            "properties": {"msg_id": {"type": "string"}},
            "required": ["msg_id"],
        },
    },
}

GMAIL_MARK_TOOL = {
    "type": "function",
    "function": {
        "name": "mark_email",
        "description": "Mark email read/unread/starred/important.",
        "parameters": {
            "type": "object",
            "properties": {
                "msg_id": {"type": "string"},
                "read": {"type": "boolean"},
                "starred": {"type": "boolean"},
                "important": {"type": "boolean"},
            },
            "required": ["msg_id"],
        },
    },
}

GMAIL_DRAFT_TOOL = {
    "type": "function",
    "function": {
        "name": "create_draft",
        "description": "Save a draft email.",
        "parameters": {
            "type": "object",
            "properties": {
                "to": {"type": "string"},
                "subject": {"type": "string"},
                "body": {"type": "string"},
                "reply_to_id": {"type": "string"},
            },
            "required": ["to", "subject", "body"],
        },
    },
}

GMAIL_FORWARD_TOOL = {
    "type": "function",
    "function": {
        "name": "forward_email",
        "description": "Forward an email to another address.",
        "parameters": {
            "type": "object",
            "properties": {
                "msg_id": {"type": "string"},
                "to": {"type": "string"},
                "note": {"type": "string"},
            },
            "required": ["msg_id", "to"],
        },
    },
}

GMAIL_BULK_TOOL = {
    "type": "function",
    "function": {
        "name": "bulk_email_action",
        "description": "Bulk action on emails matching a query (trash/archive/mark_read/mark_unread/star).",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["trash", "archive", "mark_read", "mark_unread", "star"]},
                "query": {"type": "string"},
                "max_messages": {"type": "integer"},
            },
            "required": ["action", "query"],
        },
    },
}

GMAIL_SUMMARIZE_TOOL = {
    "type": "function",
    "function": {
        "name": "summarize_thread",
        "description": "Fetch all messages in an email thread.",
        "parameters": {
            "type": "object",
            "properties": {"thread_id": {"type": "string"}},
            "required": ["thread_id"],
        },
    },
}

GMAIL_UNSUBSCRIBE_TOOL = {
    "type": "function",
    "function": {
        "name": "find_unsubscribe",
        "description": "Find unsubscribe link in an email.",
        "parameters": {
            "type": "object",
            "properties": {"msg_id": {"type": "string"}},
            "required": ["msg_id"],
        },
    },
}

# Backward-compat alias
GMAIL_TOOL = GMAIL_READ_TOOL

_EMAIL_KEYWORDS = {
    "email", "emails", "mail", "inbox", "gmail", "message", "messages",
    "unread", "latest mail", "new mail", "read my", "check my",
    "send", "reply", "forward", "delete", "trash", "archive", "draft",
    "star", "mark", "unsubscribe", "summarize", "thread",
}

_ALL_GMAIL_TOOLS = [
    GMAIL_READ_TOOL, GMAIL_SEND_TOOL, GMAIL_DELETE_TOOL, GMAIL_ARCHIVE_TOOL,
    GMAIL_MARK_TOOL, GMAIL_DRAFT_TOOL, GMAIL_FORWARD_TOOL, GMAIL_BULK_TOOL,
    GMAIL_SUMMARIZE_TOOL, GMAIL_UNSUBSCRIBE_TOOL,
]

# ── Intent → tools (minimal schemas keep context usage low) ──────────────────
#
# Rules:
#   - Reply/forward needs READ first so model knows the email details → offer both
#   - Bulk ops need only BULK tool (query-based, no msg_id)
#   - Pure read queries need only READ tool
#   - Action on a specific email needs READ (to find msg_id) + action tool

_SEND_KW = {
    "send", "send an email", "send a mail", "write an email", "write a mail",
    "compose", "compose an email", "shoot an email", "email to", "mail to",
    "write to", "drop an email", "drop a mail", "ping", "reach out",
}
_REPLY_KW = {
    "reply", "reply to", "respond", "respond to", "get back to", "write back",
    "answer", "answer to", "re:", "respond back", "send a reply",
}
_FORWARD_KW = {
    "forward", "forward this", "fwd", "pass on", "pass along",
    "share this email", "send this to",
}
_DRAFT_KW = {
    "draft", "save draft", "prepare email", "prepare a mail", "schedule email",
    "write later", "save for later",
}
_DELETE_KW = {
    "delete", "trash", "remove", "get rid of", "throw away", "discard",
    "move to trash", "bin", "erase",
}
_ARCHIVE_KW = {
    "archive", "dismiss", "clear inbox", "move out of inbox", "done with",
}
_MARK_KW = {
    "mark as read", "mark read", "mark unread", "star", "unstar",
    "flag", "unflag", "mark important", "mark as important",
    "label as read", "set as read",
}
_BULK_KW = {
    "all emails", "all mail", "all newsletters", "all promotions",
    "bulk", "mass", "batch", "every email from", "all from",
    "delete all", "archive all", "mark all", "trash all",
    "clean up", "clear all",
}
_SUMMARIZE_KW = {
    "summarize thread", "thread summary", "summarize conversation",
    "summarize this thread", "what's this thread about", "tl;dr thread",
    "sum up thread", "recap thread",
}
_UNSUBSCRIBE_KW = {
    "unsubscribe", "opt out", "stop receiving", "remove from list",
    "find unsubscribe",
}
_READ_KW = {
    "email", "emails", "mail", "inbox", "gmail", "message", "messages",
    "unread", "latest mail", "new mail", "read my", "check my", "latest email",
    "what's my", "whats my", "show my", "show me my", "any mail", "any email",
    "any messages", "got mail", "got email", "got any", "new messages",
    "spam", "promotions", "social", "socials", "updates", "forums",
    "starred", "drafts", "sent", "trash", "newsletter", "newsletters",
    "from my", "from:", "subject:", "mailbox", "my inbox",
    "first email", "latest email", "recent email", "recent mail",
    "last email", "last mail", "top email", "top mail",
    "what did", "who sent", "who emailed", "any news", "check email",
    "open my", "look at my", "peek at", "see my",
}


def get_gmail_tools(text: str, has_email_ctx: bool = False) -> list:
    """Return the minimal set of Gmail tools needed for this message."""
    lower = text.lower()

    # Bulk always wins — no msg_id needed
    if any(kw in lower for kw in _BULK_KW):
        return [GMAIL_BULK_TOOL]

    # Unsubscribe
    if any(kw in lower for kw in _UNSUBSCRIBE_KW):
        return [GMAIL_READ_TOOL, GMAIL_UNSUBSCRIBE_TOOL]

    # Thread summarize
    if any(kw in lower for kw in _SUMMARIZE_KW):
        return [GMAIL_READ_TOOL, GMAIL_SUMMARIZE_TOOL]

    # Reply / respond
    if any(kw in lower for kw in _REPLY_KW):
        return [GMAIL_READ_TOOL, GMAIL_SEND_TOOL]

    # Forward
    if any(kw in lower for kw in _FORWARD_KW):
        return [GMAIL_READ_TOOL, GMAIL_FORWARD_TOOL]

    # Draft
    if any(kw in lower for kw in _DRAFT_KW):
        return [GMAIL_DRAFT_TOOL]

    # Pure send
    if any(kw in lower for kw in _SEND_KW):
        return [GMAIL_SEND_TOOL]

    # Delete/trash
    if any(kw in lower for kw in _DELETE_KW):
        return [GMAIL_READ_TOOL, GMAIL_DELETE_TOOL]

    # Archive
    if any(kw in lower for kw in _ARCHIVE_KW):
        return [GMAIL_READ_TOOL, GMAIL_ARCHIVE_TOOL]

    # Mark/star
    if any(kw in lower for kw in _MARK_KW):
        return [GMAIL_READ_TOOL, GMAIL_MARK_TOOL]

    # "Tell me more" / "open that" — only needs read tool if no ctx yet
    if any(kw in lower for kw in _DETAIL_KW):
        return [GMAIL_READ_TOOL]

    # Default: pure read
    if any(kw in lower for kw in _READ_KW):
        return [GMAIL_READ_TOOL]

    return []


def should_check_email(text: str, has_email_ctx: bool = False) -> bool:
    return bool(get_gmail_tools(text, has_email_ctx))


_LABEL_ALIASES = {
    "spam": "SPAM", "junk": "SPAM",
    "trash": "TRASH", "bin": "TRASH",
    "sent": "SENT",
    "drafts": "DRAFTS", "draft": "DRAFTS",
    "starred": "STARRED", "starred emails": "STARRED",
    "important": "IMPORTANT",
    "promotions": "CATEGORY_PROMOTIONS", "promotion": "CATEGORY_PROMOTIONS",
    "social": "CATEGORY_SOCIAL", "socials": "CATEGORY_SOCIAL",
    "updates": "CATEGORY_UPDATES", "update": "CATEGORY_UPDATES",
    "forums": "CATEGORY_FORUMS", "forum": "CATEGORY_FORUMS",
    "primary": "CATEGORY_PERSONAL",
}


def _detect_label(text: str) -> str:
    """Detect which Gmail folder the user is asking about."""
    lower = text.lower()
    for alias, label in _LABEL_ALIASES.items():
        if alias in lower:
            return label
    return "INBOX"


# ── Smart query extraction from natural language ───────────────────────────────
# Maps common sender names/domains to Gmail from: queries
_SENDER_MAP = {
    "linkedin": "from:linkedin.com",
    "google": "from:google.com",
    "github": "from:github.com",
    "amazon": "from:amazon.com",
    "twitter": "from:twitter.com OR from:x.com",
    "facebook": "from:facebook.com",
    "instagram": "from:instagram.com",
    "youtube": "from:youtube.com",
    "netflix": "from:netflix.com",
    "spotify": "from:spotify.com",
    "apple": "from:apple.com",
    "microsoft": "from:microsoft.com",
    "slack": "from:slack.com",
    "zoom": "from:zoom.us",
    "paypal": "from:paypal.com",
    "bank": "from:bank",
    "noreply": "from:noreply",
    "newsletter": "category:promotions",
    "job": "subject:job OR subject:opportunity OR subject:hiring OR subject:application",
    "jobs": "subject:job OR subject:opportunity OR subject:hiring OR subject:application",
    "interview": "subject:interview",
    "offer": "subject:offer",
    "invoice": "subject:invoice",
    "receipt": "subject:receipt OR subject:order",
    "otp": "subject:OTP OR subject:verification OR subject:code",
    "verification": "subject:verify OR subject:verification",
    "password": "subject:password",
    "reset": "subject:reset",
    "welcome": "subject:welcome",
    "subscription": "subject:subscription",
}


def _extract_gmail_query(user_message: str) -> str:
    """Parse natural language to build a Gmail search query string."""
    lower = user_message.lower()

    # Explicit "from X" / "by X" / "sent by X"
    import re as _re
    from_match = _re.search(
        r"\b(?:from|by|sent by|message from|mail from|email from|emails? from|mails? from)\s+([a-z0-9.\-_]+)",
        lower,
    )
    if from_match:
        sender_hint = from_match.group(1).strip(".")
        # Check known map first
        for key, query in _SENDER_MAP.items():
            if key in sender_hint or sender_hint in key:
                return query
        # Fall back to from: query with the word they used
        return f"from:{sender_hint}"

    # "about X" / "subject X" / "regarding X"
    subject_match = _re.search(
        r"\b(?:about|subject[: ]+|regarding|related to|topic[: ]+)\s+['\"]?([a-z0-9 \-_]{2,30})['\"]?",
        lower,
    )
    if subject_match:
        topic = subject_match.group(1).strip()
        # Check known map
        for key, query in _SENDER_MAP.items():
            if key in topic:
                return query
        return f"subject:{topic}"

    # Check any known sender names appearing anywhere in message
    for key, query in _SENDER_MAP.items():
        if key in lower:
            return query

    return ""  # no specific filter — fetch latest


def _wants_fresh(user_message: str) -> bool:
    """True when the user clearly wants the most recent / real-time data."""
    lower = user_message.lower()
    return any(kw in lower for kw in {
        "latest", "newest", "most recent", "right now", "today",
        "just now", "current", "fresh", "real time", "real-time",
        "new", "last", "recent",
    })


def fetch_email_context(
    query: str = "",
    limit: int = 5,
    label: str = "INBOX",
    force_refresh: bool = False,
) -> str:
    """Fetch emails and format them as readable context for the LLM."""
    try:
        from app.services.gmail_service import list_emails, get_category_counts
        import re

        limit = min(limit or 5, 10)
        result = list_emails(
            max_results=limit,
            label=label,
            query=query or "",
            force_refresh=force_refresh,
        )
        emails = result.get("emails", [])

        if not emails:
            no_msg = "No emails found"
            if query:
                no_msg += f" matching '{query}'"
            if label != "INBOX":
                no_msg += f" in {label}"
            return no_msg + "."

        counts = get_category_counts()
        unread = counts.get("inbox", 0)
        source = "live" if not result.get("from_cache") else f"cached {result.get('cache_age_seconds', 0)}s ago"

        folder_display = label.replace("CATEGORY_", "").capitalize()
        header = f"{folder_display} ({source}): {unread} unread total. Showing {len(emails)} emails"
        if query:
            header += f" matching '{query}'"
        lines = [header + ":\n"]

        for i, e in enumerate(emails, 1):
            sender = re.sub(r"<[^>]+>", "", e.get("from", "")).strip() or e.get("from", "Unknown")
            unread_marker = " [UNREAD]" if e.get("unread") else ""
            lines.append(
                f"{i}. ID:{e.get('id','')} | From: {sender}{unread_marker}\n"
                f"   Subject: {e.get('subject', '(no subject)')}\n"
                f"   Preview: {e.get('snippet', '')[:200]}\n"
                f"   Date: {e.get('date', '')}\n"
            )
        return "\n".join(lines)
    except Exception as e:
        return f"Could not fetch emails: {e}"

_executor = ThreadPoolExecutor(max_workers=4)

# ── Email session context (remembers last fetched emails per session) ─────────

def _save_email_ctx(session_id: str, emails: list[dict]):
    """Store the last fetched email list in Redis so follow-ups can reference them."""
    if not session_id:
        return
    try:
        import redis as _redis
        from app.core.config import settings
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT,
                         password=settings.REDIS_PASSWORD, decode_responses=True)
        slim = [{"id": e.get("id",""), "thread_id": e.get("thread_id",""),
                 "from": e.get("from",""), "subject": e.get("subject",""),
                 "date": e.get("date","")} for e in emails]
        r.setex(f"email_ctx:{session_id}", 600, json.dumps(slim))
        r.close()
    except Exception:
        pass


def _load_email_ctx(session_id: str) -> list[dict]:
    """Load the last fetched emails for this session."""
    if not session_id:
        return []
    try:
        import redis as _redis
        from app.core.config import settings
        r = _redis.Redis(host=settings.REDIS_HOST, port=settings.REDIS_PORT,
                         password=settings.REDIS_PASSWORD, decode_responses=True)
        raw = r.get(f"email_ctx:{session_id}")
        r.close()
        return json.loads(raw) if raw else []
    except Exception:
        return []


def _resolve_email_ref(user_message: str, email_ctx: list[dict]) -> dict | None:
    """
    Given a follow-up message like 'that email', 'the first one', 'the Render email',
    return the matching email dict from the last context, or None.
    """
    if not email_ctx:
        return None
    lower = user_message.lower()

    # Ordinal: "first", "second", "third", "last", "#1", "1st" etc.
    _ordinals = {"first": 0, "1st": 0, "second": 1, "2nd": 1,
                 "third": 2, "3rd": 2, "fourth": 3, "4th": 3, "last": -1}
    for word, idx in _ordinals.items():
        if word in lower:
            try:
                return email_ctx[idx]
            except IndexError:
                pass

    # Sender name / domain in message
    for e in email_ctx:
        sender_lower = e.get("from", "").lower()
        subject_lower = e.get("subject", "").lower()
        # Check if any word from sender/subject appears in user message
        for token in sender_lower.replace("<", " ").replace(">", " ").replace("@", " ").replace(".", " ").split():
            if len(token) > 3 and token in lower:
                return e
        for token in subject_lower.split():
            if len(token) > 3 and token in lower:
                return e

    # Fallback: "that email", "it", "the email" → assume most recent (#1)
    _vague_refs = {"that email", "that mail", "that one", "the email", "the mail",
                   "this email", "this mail", " it ", "that message", "the message"}
    if any(ref in lower for ref in _vague_refs):
        return email_ctx[0]

    return None


def fetch_full_email_context(msg_id: str) -> str:
    """Fetch the full body of a specific email."""
    try:
        from app.services.gmail_service import get_email
        import re
        e = get_email(msg_id, mark_read=False)
        sender = re.sub(r"<[^>]+>", "", e.get("from", "")).strip()
        body = e.get("body", e.get("snippet", ""))[:3000]
        return (
            f"Full email:\n"
            f"From: {sender}\n"
            f"To: {e.get('to','')}\n"
            f"Subject: {e.get('subject','')}\n"
            f"Date: {e.get('date','')}\n"
            f"ID: {e.get('id','')}\n"
            f"Thread ID: {e.get('thread_id','')}\n\n"
            f"Body:\n{body}"
        )
    except Exception as ex:
        return f"Could not fetch email body: {ex}"


# ── Detail / follow-up intent keywords ───────────────────────────────────────
_DETAIL_KW = {
    "tell me more", "more about", "what does it say", "read it", "open it",
    "open that", "full email", "full content", "body of", "what's in",
    "whats in", "elaborate", "details", "detail", "expand",
    "what exactly", "read that", "read the email", "show me the full",
    "full body", "read aloud", "summarize that email", "summarize this email",
    "what is it about", "what was it about", "the full mail",
}


def _save_history_sync(
    session_id: str, user_msg: str, assistant_msg: str, model: str,
    session_mode: str = "permanent",
):
    # Temporary sessions never touch the DB
    if session_mode == "temporary":
        return

    try:
        from app.services.memory_service import _pg
        from datetime import datetime, timezone, timedelta
        title = user_msg[:80].replace("\n", " ").strip()
        expires_at = (
            datetime.now(timezone.utc) + timedelta(hours=24)
            if session_mode == "expiring"
            else None
        )
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO chat_sessions (id, title, expires_at)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
                    """,
                    (session_id, title, expires_at),
                )
                cur.execute(
                    "INSERT INTO chat_messages (session_id, role, content) VALUES (%s, 'user', %s)",
                    (session_id, user_msg),
                )
                cur.execute(
                    "INSERT INTO chat_messages (session_id, role, content, meta) VALUES (%s, 'assistant', %s, %s)",
                    (session_id, assistant_msg, json.dumps({"model": model})),
                )
            conn.commit()
    except Exception as e:
        log.warning("Failed to save chat history", error=str(e))

_EXTRACT_PROMPT = """You are a memory extractor. Given a conversation turn, decide if there is ONE notable fact worth remembering long-term about the user — preferences, goals, personal details, important topics they care about.

If there is a memorable fact, reply with ONLY that one sentence starting with "User".
If nothing is worth remembering, reply with exactly: NONE

Examples:
User: I prefer dark mode in all my apps.
Assistant: User prefers dark mode in all apps.

User: what time is it?
Assistant: NONE"""

router = APIRouter()
log = structlog.get_logger()


def _build_search_query(message: str) -> str:
    """Turn a natural-language user message into a tight, search-engine-friendly query.
    Adds the current year for version/release lookups so DDG returns recent pages."""
    import re, datetime
    year = datetime.datetime.now().year
    msg = message.strip().rstrip("?").strip()

    # Condense to the first meaningful clause
    msg = re.split(r"[.!\n]", msg)[0].strip()

    lower = msg.lower()

    # Version / release queries — prepend language name + year for recency
    _lang_version_re = re.compile(
        r"\b(python|node(?:\.?js)?|rust|go|java|typescript|php|ruby|swift|kotlin|c\+\+|c#)\b",
        re.IGNORECASE,
    )
    lang_match = _lang_version_re.search(lower)
    if lang_match and any(kw in lower for kw in ("version", "latest", "new feature", "release", "what's new", "whats new")):
        lang = lang_match.group(1)
        return f"{lang} latest version {year} new features"

    # General "what's new in X" → "X new features YEAR"
    m = re.search(r"what(?:'s| is) new in (.+)", lower)
    if m:
        return f"{m.group(1).strip()} new features {year}"

    # Generic version query
    if any(kw in lower for kw in ("latest version", "current version", "stable version")):
        return f"{msg} {year}"

    # Default: use the clause as-is, capped at 100 chars
    return msg[:100]


class HistoryMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[HistoryMessage] = []
    sessionId: str | None = None
    systemPrompt: str | None = None
    model: str | None = None
    temperature: float | None = None
    topP: float | None = None
    topK: int | None = None
    minP: float | None = None
    presencePenalty: float | None = None
    frequencyPenalty: float | None = None
    repeatPenalty: float | None = None
    maxTokens: int | None = None
    stopStrings: list[str] | None = None
    enableThinking: bool = False
    image: str | None = None  # base64-encoded image (data URI or raw base64)
    sessionMode: str = "permanent"  # "temporary" | "expiring" | "permanent"


class TokenUsage(BaseModel):
    prompt: int
    completion: int
    total: int


class ChatResponse(BaseModel):
    response: str
    sessionId: str | None = None
    model: str
    duration_ms: int
    tokens: TokenUsage


_GMAIL_CAPABILITY = (
    "You are Jazper, a personal AI assistant with live access to the user's Gmail inbox via tools. "
    "ALWAYS use the provided tools to fetch, send, or act on emails — NEVER say you cannot access email. "
    "When the user asks about any email, inbox, mail, message, or related topic, call the appropriate tool immediately. "
    "Do NOT apologize or claim you lack access. The tools are connected and working — just call them."
)

_SEARCH_CAPABILITY = (
    "You have a web_search tool. "
    "IMPORTANT: Focus only on the user's MOST RECENT message — ignore previous conversation topics when deciding what to search for. "
    "Call web_search when the current message asks about: news, current events, prices, weather, people, companies, software versions, or anything that may have changed. "
    "Search for exactly what the current message asks — not what was discussed earlier. "
    "After receiving search results, answer ONLY from those results. Your training data is outdated — trust the search."
)


def build_messages(
    req: ChatRequest,
    context: list[dict],
    core: list[str] | None = None,
    long_term: str | None = None,
    capabilities: list[str] | None = None,
    user_profile: str | None = None,
    web_search: str | None = None,
    override_image: str | None = None,
) -> list[dict]:
    messages: list[dict] = []

    system = req.systemPrompt or ""
    if capabilities:
        system = "\n".join(capabilities) + ("\n\n" + system if system else "")
    if user_profile:
        system += ("\n\n" if system else "") + user_profile
    if core:
        system += "\n\n[Things to always remember about the user]\n" + "\n".join(f"- {c}" for c in core)
    if long_term:
        system += f"\n\n[Relevant memories from past conversations]\n{long_term}"
    if web_search and "unavailable" not in web_search.lower():
        system += (
            f"\n\n[LIVE SEARCH RESULTS]\n"
            f"Use ONLY these results for facts. Do NOT fall back to training data.\n\n"
            f"{web_search[:1200]}"
        )
    if system:
        messages.append({"role": "system", "content": system.strip()})

    history = [{"role": m.role, "content": m.content} for m in req.history] if req.history else context
    # Cap history to last 6 messages — old unrelated exchanges confuse the model.
    # A small model (7-9B) loses track of the CURRENT question when 10+ prior turns
    # from different topics are in context.
    history = history[-6:]
    # Strip out any prior "I cannot access" or "I apologize" refusals from history
    # so they don't anchor the model into repeating the same refusal pattern
    cleaned_history = []
    _denial_phrases = (
        "cannot access your", "do not have access", "don't have access", "unable to access",
        "i apologize, but as an ai", "i do not have the capability to perform real-time",
        "i cannot perform real-time",
    )
    for msg in history:
        if msg.get("role") == "assistant" and any(p in msg.get("content", "").lower() for p in _denial_phrases):
            continue
        cleaned_history.append(msg)

    image = override_image or req.image
    if image:
        data_url = image if image.startswith("data:") else f"data:image/jpeg;base64,{image}"
        user_content: str | list = [
            {"type": "text", "text": req.message or "Describe this image."},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]
    else:
        user_content = req.message

    messages += cleaned_history + [{"role": "user", "content": user_content}]
    return messages


@router.post("/", response_model=ChatResponse)
async def chat(req: ChatRequest):
    log.info("Chat request", session=req.sessionId)

    context: list[dict] = []
    if req.sessionId:
        history = await memory_service.get_short_term(f"session:{req.sessionId}")
        if history:
            context = json.loads(history)

    messages = build_messages(req, context)

    result = await ai_provider.chat(
        messages=messages,
        model=req.model,
        temperature=req.temperature,
        top_p=req.topP,
        top_k=req.topK,
        min_p=req.minP,
        presence_penalty=req.presencePenalty,
        frequency_penalty=req.frequencyPenalty,
        repeat_penalty=req.repeatPenalty,
        max_tokens=req.maxTokens,
        stop=req.stopStrings or None,
        enable_thinking=req.enableThinking,
    )

    if req.sessionId:
        updated = context + [
            {"role": "user", "content": req.message},
            {"role": "assistant", "content": result.content},
        ]
        await memory_service.store_short_term(
            f"session:{req.sessionId}", json.dumps(updated[-6:])
        )

    log.info("Chat done", duration_ms=result.duration_ms, tokens=result.total_tokens)

    return ChatResponse(
        response=result.content,
        sessionId=req.sessionId,
        model=result.model,
        duration_ms=result.duration_ms,
        tokens=TokenUsage(
            prompt=result.prompt_tokens,
            completion=result.completion_tokens,
            total=result.total_tokens,
        ),
    )


@router.post("/stream")
async def chat_stream(req: ChatRequest):
    import asyncio
    loop = asyncio.get_running_loop()

    # ── All pre-request lookups in parallel ───────────────────────────────
    async def _get_session():
        if not req.sessionId:
            return []
        try:
            raw = await memory_service.get_short_term(f"session:{req.sessionId}")
            return json.loads(raw) if raw else []
        except Exception:
            return []

    async def _get_email_ctx():
        if not req.sessionId:
            return []
        return await loop.run_in_executor(_executor, lambda: _load_email_ctx(req.sessionId))

    async def _get_profile():
        try:
            from app.routes.profile import get_profile_sync, format_profile_for_prompt
            raw_profile = await loop.run_in_executor(_executor, get_profile_sync)
            return format_profile_for_prompt(raw_profile) if raw_profile else None
        except Exception:
            return None

    async def _get_core():
        return await loop.run_in_executor(_executor, memory_service.get_core_memories_sync)

    async def _get_longterm():
        try:
            from app.services.embedding_service import embed as local_embed, is_available
            if not is_available():
                return None
            embedding = await loop.run_in_executor(_executor, lambda: local_embed(req.message))
            if not embedding:
                return None
            relevant = await loop.run_in_executor(
                _executor, lambda: memory_service.search_memories_sync(embedding, top_k=4),
            )
            return "\n".join(f"- {m}" for m in relevant) if relevant else None
        except Exception:
            return None

    # ── Web search helper — runs in parallel with memory lookups ─────────────
    async def _get_web_search():
        if not should_search(req.message):
            return ""
        try:
            query = _build_search_query(req.message)
            return await loop.run_in_executor(_executor, lambda: run_search(query))
        except Exception:
            return ""

    # ── Last-image recall — inject previous image for follow-up questions ─────
    async def _get_last_image() -> str | None:
        """Return the last image sent in this session (stored for 10 min), or None."""
        if not req.sessionId:
            return None
        try:
            raw = await memory_service.get_short_term(f"img:{req.sessionId}")
            return raw if raw else None
        except Exception:
            return None

    context, email_ctx, user_profile_text, core_memories, long_term_text, web_search_results = (
        await asyncio.gather(
            _get_session(), _get_email_ctx(), _get_profile(), _get_core(), _get_longterm(),
            _get_web_search(),
        )
    )

    # ── Image resolution — use current image or recall last one for follow-ups ─
    active_image: str | None = req.image
    if not active_image and req.sessionId:
        active_image = await _get_last_image()
    if req.image and req.sessionId:
        # Store new image for follow-up questions (10-min TTL)
        try:
            await memory_service.store_short_term(f"img:{req.sessionId}", req.image, ttl=600)
        except Exception:
            pass

    # ── Pre-resolve email reference BEFORE tool dispatch ──────────────────
    resolved_email: dict | None = _resolve_email_ref(req.message, email_ctx)

    lower_msg = req.message.lower()

    # ── Gmail tools ───────────────────────────────────────────────────────
    tools: list = []
    capabilities: list[str] = []

    # "Tell me more" / "what does it say" — if we already have the email resolved,
    # skip the tool call entirely and inject the full body directly as user context
    is_detail_request = any(kw in lower_msg for kw in _DETAIL_KW)

    gmail_tools = get_gmail_tools(req.message)
    if gmail_tools and not (is_detail_request and resolved_email):
        tools.extend(gmail_tools)
        capabilities.append(_GMAIL_CAPABILITY)

    # Build extra context to prepend when we have a resolved email
    extra_context = ""
    if resolved_email:
        extra_context = (
            f"\n\n[Email the user is referring to]\n"
            f"ID: {resolved_email.get('id','')}\n"
            f"Thread ID: {resolved_email.get('thread_id','')}\n"
            f"From: {resolved_email.get('from','')}\n"
            f"Subject: {resolved_email.get('subject','')}\n"
            f"Date: {resolved_email.get('date','')}\n"
        )

    messages = build_messages(
        req, context, core_memories or None, long_term_text,
        capabilities or None, user_profile_text,
        web_search=web_search_results or None,
        override_image=active_image,
    )

    # Inject email reference context into the last user message
    if extra_context:
        for i in range(len(messages) - 1, -1, -1):
            if messages[i]["role"] == "user":
                content = messages[i]["content"]
                if isinstance(content, str):
                    messages[i] = {**messages[i], "content": content + extra_context}
                elif isinstance(content, list):
                    new_content = list(content)
                    for j, part in enumerate(new_content):
                        if part.get("type") == "text":
                            new_content[j] = {**part, "text": part["text"] + extra_context}
                            break
                    messages[i] = {**messages[i], "content": new_content}
                break

    start = time.monotonic()
    full_content: list[str] = []
    token_usage: dict = {"prompt": 0, "completion": 0, "total": 0}

    stream_kwargs = dict(
        model=req.model,
        temperature=req.temperature,
        top_p=req.topP,
        top_k=req.topK,
        min_p=req.minP,
        presence_penalty=req.presencePenalty,
        frequency_penalty=req.frequencyPenalty,
        repeat_penalty=req.repeatPenalty,
        max_tokens=req.maxTokens,
        stop=req.stopStrings or None,
        enable_thinking=req.enableThinking,
    )

    # ── Tool execution helper — single source of truth for all tool calls ────
    async def _dispatch_tool(tool_name: str, args: dict) -> tuple[str, str]:
        """Execute a tool. Returns (status_message, result_string)."""
        # Inject email reference fields if model didn't supply them
        if not args.get("msg_id") and resolved_email:
            args["msg_id"] = resolved_email.get("id", "")
        if not args.get("thread_id") and resolved_email:
            args["thread_id"] = resolved_email.get("thread_id", "")

        if tool_name == "read_email":
            q = args.get("query", "") or _extract_gmail_query(req.message)
            limit = int(args.get("limit", 5))
            label = _detect_label(req.message)
            fresh = _wants_fresh(req.message)
            folder_name = label.replace("CATEGORY_", "").capitalize()
            status = f"Searching {folder_name}" + (f" for '{q}'" if q else ", fetching latest") + "…"
            def _fetch():
                from app.services.gmail_service import list_emails, get_category_counts
                import re as _re
                res = list_emails(max_results=limit, label=label, query=q, force_refresh=fresh)
                emails = res.get("emails", [])
                if emails and req.sessionId:
                    _save_email_ctx(req.sessionId, emails)
                if not emails:
                    return "No emails found" + (f" matching '{q}'" if q else "") + "."
                counts = get_category_counts()
                unread = counts.get("inbox", 0)
                source = "live" if not res.get("from_cache") else f"cached {res.get('cache_age_seconds',0)}s ago"
                lines = [f"{folder_name} ({source}): {unread} unread. Showing {len(emails)}:\n"]
                for i, e in enumerate(emails, 1):
                    sender = _re.sub(r"<[^>]+>", "", e.get("from","")).strip() or e.get("from","?")
                    unread_m = " [UNREAD]" if e.get("unread") else ""
                    lines.append(f"{i}. ID:{e.get('id','')} | From:{sender}{unread_m}\n"
                                 f"   Subject:{e.get('subject','(no subject)')}\n"
                                 f"   Preview:{e.get('snippet','')[:200]}\n"
                                 f"   Date:{e.get('date','')}\n")
                return "\n".join(lines)
            return status, await loop.run_in_executor(_executor, _fetch)

        elif tool_name == "send_email":
            _a = dict(args)
            if not _a.get("reply_to_id") and resolved_email:
                _a["reply_to_id"] = resolved_email.get("thread_id")
            def _send():
                from app.services.gmail_service import send_email
                r = send_email(_a.get("to",""), _a.get("subject",""), _a.get("body",""), _a.get("reply_to_id"))
                return f"Email sent. ID: {r.get('id','?')}"
            try:
                return "Sending email…", await loop.run_in_executor(_executor, _send)
            except Exception as e:
                return "Sending email…", f"Failed to send: {e}"

        elif tool_name == "trash_email":
            _mid = args.get("msg_id","")
            def _trash():
                from app.services.gmail_service import trash_email
                trash_email(_mid); return "Email trashed."
            try:
                return "Moving to trash…", await loop.run_in_executor(_executor, _trash)
            except Exception as e:
                return "Moving to trash…", f"Failed: {e}"

        elif tool_name == "archive_email":
            _mid = args.get("msg_id","")
            def _archive():
                from app.services.gmail_service import archive_email
                archive_email(_mid); return "Email archived."
            try:
                return "Archiving…", await loop.run_in_executor(_executor, _archive)
            except Exception as e:
                return "Archiving…", f"Failed: {e}"

        elif tool_name == "mark_email":
            _mid = args.get("msg_id","")
            _a = dict(args)
            def _mark():
                from app.services.gmail_service import mark_email
                mark_email(_mid, read=_a.get("read"), starred=_a.get("starred"), important=_a.get("important"))
                return "Email updated."
            try:
                return "Updating email…", await loop.run_in_executor(_executor, _mark)
            except Exception as e:
                return "Updating email…", f"Failed: {e}"

        elif tool_name == "create_draft":
            _a = dict(args)
            def _draft():
                from app.services.gmail_service import create_draft
                r = create_draft(_a.get("to",""), _a.get("subject",""), _a.get("body",""), _a.get("reply_to_id"))
                return f"Draft saved. ID: {r.get('id','?')}"
            try:
                return "Saving draft…", await loop.run_in_executor(_executor, _draft)
            except Exception as e:
                return "Saving draft…", f"Failed: {e}"

        elif tool_name == "forward_email":
            _a = dict(args)
            def _fwd():
                from app.services.gmail_service import forward_email
                r = forward_email(_a.get("msg_id",""), _a.get("to",""), _a.get("note",""))
                return f"Forwarded. ID: {r.get('id','?')}"
            try:
                return "Forwarding…", await loop.run_in_executor(_executor, _fwd)
            except Exception as e:
                return "Forwarding…", f"Failed: {e}"

        elif tool_name == "bulk_email_action":
            _action = args.get("action","trash")
            _q = args.get("query","")
            def _bulk():
                from app.services.gmail_service import bulk_action
                r = bulk_action(_action, _q, int(args.get("max_messages", 50)))
                return f"Done. Processed {r.get('processed',0)} emails."
            try:
                return f"Bulk {_action}: {_q}…", await loop.run_in_executor(_executor, _bulk)
            except Exception as e:
                return f"Bulk {_action}…", f"Failed: {e}"

        elif tool_name == "summarize_thread":
            _tid = args.get("thread_id","")
            def _summ():
                from app.services.gmail_service import summarize_thread
                data = summarize_thread(_tid)
                msgs = data.get("messages",[])
                lines = [f"Thread — {data.get('message_count',0)} messages:\n"]
                for i, m in enumerate(msgs, 1):
                    lines.append(f"[{i}] From:{m.get('from','')} | {m.get('date','')}\n{m.get('body','')}\n")
                return "\n".join(lines)
            try:
                return "Loading thread…", await loop.run_in_executor(_executor, _summ)
            except Exception as e:
                return "Loading thread…", f"Failed: {e}"

        elif tool_name == "find_unsubscribe":
            _mid = args.get("msg_id","")
            def _unsub():
                from app.services.gmail_service import find_unsubscribe_link
                data = find_unsubscribe_link(_mid)
                return f"Unsubscribe link ({data.get('method')}): {data.get('url')}" if data.get("found") else "No unsubscribe link found."
            try:
                return "Scanning for unsubscribe link…", await loop.run_in_executor(_executor, _unsub)
            except Exception as e:
                return "Scanning…", f"Failed: {e}"

        elif tool_name == "web_search":
            query = args.get("query", "")
            result = await loop.run_in_executor(_executor, lambda: run_search(query))
            return query, result

        else:
            return f"Running {tool_name}…", f"Tool '{tool_name}' executed (no result)."

    # ── Main streaming generator ──────────────────────────────────────────────
    async def generate():
        try:
            async for event in _generate_inner(messages):
                yield event
        except Exception as e:
            log.error("Unhandled error in generate()", error=str(e))
            yield f"data: [ERROR]{json.dumps(str(e))}\n\n"
            yield "data: [DONE]\n\n"

    async def _generate_inner(messages):
        active_messages = list(messages)

        async def _stream_and_forward(msgs):
            """Stream from AI, intercept sentinels, forward content as SSE."""
            async for chunk in ai_provider.stream(messages=msgs, **stream_kwargs):
                if chunk.startswith('{"__reasoning__":'):
                    try:
                        reasoning_text = json.loads(chunk)["__reasoning__"]
                        yield f"data: [THINKING]{json.dumps(reasoning_text)}\n\n"
                    except Exception:
                        pass
                    continue
                if chunk.startswith('{"__usage__":'):
                    try:
                        u = json.loads(chunk)["__usage__"]
                        token_usage["prompt"]     = u.get("prompt", 0)
                        token_usage["completion"] = u.get("completion", 0)
                        token_usage["total"]      = u.get("total", 0)
                    except Exception:
                        pass
                    continue
                full_content.append(chunk)
                yield f"data: {chunk.replace(chr(10), chr(92)+'n')}\n\n"

        # If we pre-ran a web search, show the searching indicator then stream normally
        if web_search_results and "unavailable" not in web_search_results.lower():
            import re as _re2
            _q = _re2.split(r"[.!?\n]", req.message.strip().rstrip("?"))[0][:80]
            yield f"data: [SEARCHING]{json.dumps(_q)}\n\n"
            async for sse in _stream_and_forward(active_messages):
                yield sse
            yield "data: [SEARCHING_DONE]\n\n"

        # Shortcut: "tell me more" + we already know which email
        elif is_detail_request and resolved_email:
            msg_id = resolved_email.get("id", "")
            yield f"data: [SEARCHING]{json.dumps('Fetching full email…')}\n\n"
            full_body = await loop.run_in_executor(_executor, lambda: fetch_full_email_context(msg_id))
            active_messages.append({
                "role": "assistant", "content": None,
                "tool_calls": [{"id": "detail_auto", "type": "function",
                                "function": {"name": "read_email", "arguments": json.dumps({"query": "", "limit": 1})}}],
            })
            active_messages.append({"role": "tool", "tool_call_id": "detail_auto", "content": full_body})
            async for sse in _stream_and_forward(active_messages):
                yield sse
            yield "data: [SEARCHING_DONE]\n\n"

        elif not tools:
            # Plain stream — no tool overhead
            async for sse in _stream_and_forward(active_messages):
                yield sse

        else:
            # ── ReAct loop — up to MAX_STEPS tool calls before final answer ──
            MAX_STEPS = 8
            used_search = False

            for _step in range(MAX_STEPS):
                got_tool = False
                tool_event: dict = {}

                async for event in ai_provider.stream_with_tools(
                    messages=active_messages, tools=tools, **stream_kwargs
                ):
                    if isinstance(event, dict) and event.get("tool_call"):
                        got_tool = True
                        tool_event = event
                    else:
                        # Text chunk — stream immediately (final answer phase)
                        full_content.append(event)
                        yield f"data: {event.replace(chr(10), chr(92)+'n')}\n\n"

                if not got_tool:
                    # Final answer was streamed above
                    break

                # Parse args
                args = tool_event.get("arguments", {})
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except Exception:
                        args = {}
                tool_name = tool_event.get("name", "web_search")
                tool_id   = tool_event["id"]

                # Execute + yield status
                status, tool_result = await _dispatch_tool(tool_name, dict(args))
                yield f"data: [SEARCHING]{json.dumps(status)}\n\n"

                # Append tool call + result to conversation
                active_messages.append({
                    "role": "assistant", "content": None,
                    "tool_calls": [{
                        "id": tool_id, "type": "function",
                        "function": {"name": tool_name, "arguments": json.dumps(args)},
                    }],
                })
                active_messages.append({
                    "role": "tool", "tool_call_id": tool_id, "content": tool_result,
                })

                if tool_name == "web_search":
                    used_search = True

            else:
                # Exhausted MAX_STEPS — force a final answer
                active_messages.append({
                    "role": "user",
                    "content": "Please give your final answer based on what you've gathered so far.",
                })
                async for chunk in ai_provider.stream(messages=active_messages, **stream_kwargs):
                    full_content.append(chunk)
                    yield f"data: {chunk.replace(chr(10), chr(92)+'n')}\n\n"

            if used_search or any(isinstance(e, dict) and e.get("tool_call") for e in []):
                yield "data: [SEARCHING_DONE]\n\n"
            else:
                yield "data: [SEARCHING_DONE]\n\n"

        duration_ms = int((time.monotonic() - start) * 1000)
        assembled = "".join(full_content)

        # ── Session memory (Redis) — only store clean user/assistant text pairs.
        # Never persist tool_calls or tool role messages — they confuse the model
        # on the next turn (it re-summarizes old search results instead of the new question).
        if req.sessionId:
            try:
                clean_context = [
                    m for m in context
                    if m.get("role") in ("user", "assistant")
                    and m.get("tool_calls") is None
                    and isinstance(m.get("content"), str)
                ]
                updated = clean_context + [
                    {"role": "user", "content": req.message},
                    {"role": "assistant", "content": assembled},
                ]
                await memory_service.store_short_term(
                    f"session:{req.sessionId}", json.dumps(updated[-20:]), ttl=86400
                )
            except Exception:
                pass

        # ── Send [META] + [DONE] immediately — don't block on background work ────
        meta = json.dumps({
            "duration_ms": duration_ms,
            "model": req.model or "unknown",
            "tokens": token_usage,
        })
        yield f"data: [META]{meta}\n\n"
        yield "data: [DONE]\n\n"

        # ── Everything below runs after [DONE] — truly fire-and-forget ─────────────
        async def _background_work():
            # Save chat history to PostgreSQL
            if req.sessionId:
                await loop.run_in_executor(
                    _executor,
                    lambda: _save_history_sync(req.sessionId, req.message, assembled, req.model or "unknown", req.sessionMode),
                )

            # Auto memory (local embeddings → semantic_memories)
            try:
                from app.services.embedding_service import embed as local_embed, is_available
                if is_available():
                    turn = f"User: {req.message}\nAssistant: {assembled[:800]}"
                    emb = await loop.run_in_executor(_executor, lambda: local_embed(turn))
                    if emb:
                        await loop.run_in_executor(
                            _executor, lambda: memory_service.store_memory_sync(turn, emb, {"session": req.sessionId}),
                        )
            except Exception:
                pass

            # Extracted memory — LLM fact extraction
            try:
                extract_msgs = [
                    {"role": "system", "content": _EXTRACT_PROMPT},
                    {"role": "user", "content": f"User: {req.message}\nAssistant: {assembled[:300]}"},
                ]
                extract_result = await ai_provider.chat(
                    messages=extract_msgs,
                    model=req.model,
                    max_tokens=80,
                    temperature=0.0,
                    enable_thinking=False,
                )
                fact = extract_result.content.strip()
                for _prefix in ("thinking process:", "thought:", "reasoning:", "analysis:", "step"):
                    if fact.lower().startswith(_prefix):
                        lines = [l.strip() for l in fact.splitlines() if l.strip()]
                        fact = next((l for l in lines if l.lower().startswith("user")), "NONE")
                        break
                if fact and fact.upper() != "NONE" and fact.lower().startswith("user"):
                    await loop.run_in_executor(
                        _executor,
                        lambda: memory_service.store_extracted_sync(fact, req.sessionId),
                    )
            except Exception:
                pass

        asyncio.create_task(_background_work())

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
