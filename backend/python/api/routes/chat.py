from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import structlog
import json
import time
from concurrent.futures import ThreadPoolExecutor

from core.providers.ai_provider import ai_provider
from core.services.memory_service import memory_service
from core.services.search_service import run_search, should_search

# ── Gmail tool definitions (OpenAI tool-call format) ──────────────────────────
GMAIL_READ_TOOL = {
    "type": "function",
    "function": {
        "name": "read_email",
        "description": (
            "Search and fetch emails from Gmail. Use this tool for ANY email-related request: "
            "reading inbox, searching for specific emails, finding emails by topic, sender, subject, "
            "date, or any other criteria. This is the ONLY email search/fetch tool available — "
            "do NOT call search_emails, list_emails, fetch_emails, or any other variant. "
            "Pass a Gmail search query (e.g. 'remote job', 'from:recruiter@company.com', "
            "'subject:interview', 'is:unread') or leave empty for the latest inbox."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "Gmail search filter. Examples: 'remote job', 'from:hr@company.com', "
                        "'subject:offer', 'is:unread', 'after:2024/01/01'. "
                        "Leave empty to fetch latest inbox. Do NOT add sort_by or order — "
                        "Gmail always returns newest first."
                    ),
                },
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

# ── Job-apply tools ───────────────────────────────────────────────────────────

JOB_APPLY_RUN_TOOL = {
    "type": "function",
    "function": {
        "name": "job_apply_run",
        "description": "Trigger a LinkedIn Easy Apply automation run using the saved profile and preferences.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}

JOB_STATUS_TOOL = {
    "type": "function",
    "function": {
        "name": "job_status",
        "description": "Get a summary of recent job applications: how many sent, responses, interviews.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}

JOB_PROFILE_TOOL = {
    "type": "function",
    "function": {
        "name": "job_profile",
        "description": "Get the current job search preferences: target roles, work mode, salary range, daily limit.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}

_JOB_APPLY_KW = {
    "apply jobs", "apply for jobs", "apply to jobs", "run job apply",
    "start applying", "apply on linkedin", "linkedin apply",
    "job apply", "apply today", "apply now",
}
_JOB_STATUS_KW = {
    "job status", "application status", "my applications", "how many jobs",
    "how many applied", "jobs applied", "job applications", "did i get",
    "any responses", "any replies", "recruiter", "interview",
    "what jobs", "show applications", "application tracker",
}
_JOB_PROFILE_KW = {
    "job preferences", "job profile", "target roles", "work mode", "daily limit",
    "my preferences", "what jobs am i applying", "what am i looking for",
}

_JOB_CAPABILITY = (
    "You have access to job-apply tools. You CAN trigger LinkedIn job applications, "
    "check application status, and view job search preferences. "
    "Use job_apply_run to start an apply session, job_status for a summary, "
    "job_profile to see current preferences."
)


def get_job_tools(text: str) -> list:
    """Return the minimal job tool set needed for this message."""
    lower = text.lower()
    if any(kw in lower for kw in _JOB_APPLY_KW):
        return [JOB_APPLY_RUN_TOOL]
    if any(kw in lower for kw in _JOB_STATUS_KW):
        return [JOB_STATUS_TOOL]
    if any(kw in lower for kw in _JOB_PROFILE_KW):
        return [JOB_PROFILE_TOOL]
    return []

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


def get_gmail_tools(text: str, has_email_ctx: bool = False) -> list:  # noqa: ARG001
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


_DARWIN_REPAIR_PATTERNS = [
    r"\b(fix|repair|diagnose|debug|self.?repair|patch)\b.{0,40}\b(error|bug|issue|crash|failure|problem)\b",
    r"\b(error|bug|crash|failure)\b.{0,40}\b(fix|repair|diagnose|debug)\b",
    r"\bask darwin\b",
    r"\btrigger.{0,10}(repair|darwin)\b",
    r"\bwhat.{0,15}(errors?|bugs?|issues?).{0,20}(system|jazper|os)\b",
    r"\bshow.{0,15}(recent|latest).{0,15}errors?\b",
    r"\brun.{0,10}self.?repair\b",
]

_DARWIN_CREATE_PATTERNS = [
    r"\b(build|create|generate|make|add).{0,30}(agent|feature|endpoint|worker|tool)\b",
    r"\bself.?create\b",
    r"\bnew.{0,20}(agent|feature|module|service)\b",
    r"\bask darwin.{0,15}creat\b",
]


def _detect_darwin_intent(text: str) -> str | None:
    """Return 'repair', 'create', or None based on user message."""
    import re
    lower = text.lower().strip()
    for pattern in _DARWIN_REPAIR_PATTERNS:
        if re.search(pattern, lower, re.IGNORECASE):
            return "repair"
    for pattern in _DARWIN_CREATE_PATTERNS:
        if re.search(pattern, lower, re.IGNORECASE):
            return "create"
    return None


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
    import re as _re

    # 1. Explicit "from X" / "by X" / "sent by X" — highest specificity
    from_match = _re.search(
        r"\b(?:from|by|sent by|message from|mail from|email from|emails? from|mails? from)\s+([a-z0-9.\-_]+)",
        lower,
    )
    if from_match:
        sender_hint = from_match.group(1).strip(".")
        for key, query in _SENDER_MAP.items():
            if key in sender_hint or sender_hint in key:
                return query
        return f"from:{sender_hint}"

    # 2. Scan for known topic/sender keywords anywhere in the full message.
    #    Do this BEFORE subject-regex so "jobs", "interview", "invoice" etc. in
    #    "mails related to remote jobs" are caught without the regex misfiring on
    #    structural words like "about" or "tell me about".
    for key, query in _SENDER_MAP.items():
        if _re.search(r"\b" + _re.escape(key) + r"\b", lower):
            return query

    # 3. "about X" / "related to X" / "regarding X" — last resort for free-form topics
    subject_match = _re.search(
        r"\b(?:about|subject[: ]+|regarding|related to|on the topic of|topic[: ]+)\s+['\"]?([a-z0-9 \-_]{2,40}?)(?=\s+(?:only|please|emails?|mails?)\b|\s*[,.]|\s*$)",
        lower,
    )
    if subject_match:
        topic = subject_match.group(1).strip()
        if topic:
            return f"subject:{topic}"

    return ""  # no specific filter — fetch latest inbox


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
        from core.services.gmail_service import list_emails, get_category_counts
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


_EMAIL_READ_ALIASES = {
    "search_emails", "fetch_emails", "get_emails", "list_emails", "query_emails",
    "find_emails", "check_email", "get_email_list", "get_inbox", "fetch_inbox",
    "search_inbox", "check_inbox", "email_search", "inbox_search",
    "get_mail", "fetch_mail", "search_mail", "list_mail",
}

# Matches text-format tool calls that some models emit instead of proper API tool_calls
# e.g. read_email('remote job') or search_emails(query="jobs")
import re as _re_mod
_TEXT_TOOL_RE = _re_mod.compile(
    r'\b(read_email|search_emails|list_emails|fetch_emails|get_emails|find_emails|'
    r'send_email|trash_email|archive_email|mark_email|web_search)\s*\('
    r'([^)]*)\)',
    _re_mod.IGNORECASE,
)

def _normalize_tool_call(tool_name: str, args: dict) -> tuple[str, dict]:
    """Normalize LLM-generated tool name variants and clean up args."""
    if tool_name in _EMAIL_READ_ALIASES:
        tool_name = "read_email"
        # Unify query arg from any synonym the LLM might have used
        if "query" not in args:
            for k in ("search_query", "q", "keywords", "search", "filter", "term"):
                if k in args:
                    args = {"query": args[k]}
                    break
            else:
                args = {"query": ""}
        else:
            # Strip unknown params (sort_by, order, etc.) — Gmail always returns newest-first
            args = {"query": args.get("query", "")}
    return tool_name, args


async def _dispatch_tool_standalone(
    tool_name: str,
    args: dict,
    resolved_email: dict | None,
    session_id: str | None,
    user_message: str,
    loop,
    executor,
) -> str:
    """
    Module-level tool dispatcher used by HermesAgent.
    Mirrors _dispatch_tool() logic but without closure dependencies.
    Returns only the result string (no status message).
    """
    import re as _re
    tool_name, args = _normalize_tool_call(tool_name, args)
    if not args.get("msg_id") and resolved_email:
        args["msg_id"] = resolved_email.get("id", "")
    if not args.get("thread_id") and resolved_email:
        args["thread_id"] = resolved_email.get("thread_id", "")

    if tool_name == "read_email":
        q = args.get("query", "") or _extract_gmail_query(user_message)
        limit = int(args.get("limit", 10))
        label = _detect_label(user_message)
        fresh = _wants_fresh(user_message)
        folder_name = label.replace("CATEGORY_", "").capitalize()
        def _fetch():
            from core.services.gmail_service import list_emails, get_category_counts
            res = list_emails(max_results=limit, label=label, query=q, force_refresh=fresh)
            emails = res.get("emails", [])
            if emails and session_id:
                _save_email_ctx(session_id, emails)
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
        try:
            return await loop.run_in_executor(executor, _fetch)
        except Exception as e:
            return f"Gmail error: {e}. Cannot access inbox."

    elif tool_name == "send_email":
        _a = dict(args)
        if not _a.get("reply_to_id") and resolved_email:
            _a["reply_to_id"] = resolved_email.get("thread_id")
        def _send():
            from core.services.gmail_service import send_email
            r = send_email(_a.get("to",""), _a.get("subject",""), _a.get("body",""), _a.get("reply_to_id"))
            return f"Email sent. ID: {r.get('id','?')}"
        try:
            return await loop.run_in_executor(executor, _send)
        except Exception as e:
            return f"Failed to send: {e}"

    elif tool_name == "trash_email":
        _mid = args.get("msg_id","")
        def _trash():
            from core.services.gmail_service import trash_email
            trash_email(_mid); return "Email trashed."
        try:
            return await loop.run_in_executor(executor, _trash)
        except Exception as e:
            return f"Failed: {e}"

    elif tool_name == "archive_email":
        _mid = args.get("msg_id","")
        def _arch():
            from core.services.gmail_service import archive_email
            archive_email(_mid); return "Email archived."
        try:
            return await loop.run_in_executor(executor, _arch)
        except Exception as e:
            return f"Failed: {e}"

    elif tool_name == "mark_email":
        _mid = args.get("msg_id","")
        _a = dict(args)
        def _mark():
            from core.services.gmail_service import mark_email
            mark_email(_mid, read=_a.get("read"), starred=_a.get("starred"), important=_a.get("important"))
            return "Email updated."
        try:
            return await loop.run_in_executor(executor, _mark)
        except Exception as e:
            return f"Failed: {e}"

    elif tool_name == "create_draft":
        _a = dict(args)
        def _draft():
            from core.services.gmail_service import create_draft
            r = create_draft(_a.get("to",""), _a.get("subject",""), _a.get("body",""), _a.get("reply_to_id"))
            return f"Draft saved. ID: {r.get('id','?')}"
        try:
            return await loop.run_in_executor(executor, _draft)
        except Exception as e:
            return f"Failed: {e}"

    elif tool_name == "forward_email":
        _a = dict(args)
        def _fwd():
            from core.services.gmail_service import forward_email
            r = forward_email(_a.get("msg_id",""), _a.get("to",""), _a.get("note",""))
            return f"Forwarded. ID: {r.get('id','?')}"
        try:
            return await loop.run_in_executor(executor, _fwd)
        except Exception as e:
            return f"Failed: {e}"

    elif tool_name == "bulk_email_action":
        _action = args.get("action","trash")
        _q = args.get("query","")
        def _bulk():
            from core.services.gmail_service import bulk_action
            r = bulk_action(_action, _q, int(args.get("max_messages", 50)))
            return f"Done. Processed {r.get('processed',0)} emails."
        try:
            return await loop.run_in_executor(executor, _bulk)
        except Exception as e:
            return f"Failed: {e}"

    elif tool_name == "summarize_thread":
        _tid = args.get("thread_id","")
        def _summ():
            from core.services.gmail_service import summarize_thread
            data = summarize_thread(_tid)
            msgs = data.get("messages",[])
            lines = [f"Thread — {data.get('message_count',0)} messages:\n"]
            for i, m in enumerate(msgs, 1):
                lines.append(f"[{i}] From:{m.get('from','')} | {m.get('date','')}\n{m.get('body','')}\n")
            return "\n".join(lines)
        try:
            return await loop.run_in_executor(executor, _summ)
        except Exception as e:
            return f"Failed: {e}"

    elif tool_name == "find_unsubscribe":
        _mid = args.get("msg_id","")
        def _unsub():
            from core.services.gmail_service import find_unsubscribe_link
            data = find_unsubscribe_link(_mid)
            return f"Unsubscribe link ({data.get('method')}): {data.get('url')}" if data.get("found") else "No unsubscribe link found."
        try:
            return await loop.run_in_executor(executor, _unsub)
        except Exception as e:
            return f"Failed: {e}"

    elif tool_name == "web_search":
        query = args.get("query", "")
        return await loop.run_in_executor(executor, lambda: run_search(query))

    return (
        f"Error: tool '{tool_name}' is not available. "
        f"Available email tools: read_email, send_email, trash_email, archive_email, "
        f"mark_email, create_draft, forward_email, bulk_email_action, summarize_thread, find_unsubscribe."
    )

# ── Email session context (remembers last fetched emails per session) ─────────

def _save_email_ctx(session_id: str, emails: list[dict]):
    """Store the last fetched email list in Redis so follow-ups can reference them."""
    if not session_id:
        return
    try:
        import redis as _redis
        from core.config import settings
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
        from core.config import settings
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
        from core.services.gmail_service import get_email
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
        from memory.db.legacy_pg import _pg
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
    agentConfig: dict | None = None  # per-agent overrides from frontend settings


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
    "You have live access to the user's Gmail inbox via the `read_email` tool. "
    "When asked about emails, call `read_email` immediately — do NOT output text like 'search_emails(...)'. "
    "Pass a Gmail query string (e.g. 'remote job', 'from:boss@co.com', 'is:unread') or leave it empty for latest inbox. "
    "Gmail always returns newest-first — do NOT add sort_by, order, or limit params.\n"
    "CRITICAL RULES — violating these is a serious error:\n"
    "1. NEVER fabricate, invent, or guess emails. NEVER use training-data knowledge about emails.\n"
    "2. After calling read_email, your response MUST be based EXCLUSIVELY on the tool result content.\n"
    "3. Report the EXACT sender, subject, date, and preview from the tool result — copy them verbatim.\n"
    "4. If the tool returns 'No emails found', tell the user that — do NOT invent alternatives.\n"
    "5. Today is 2026. Any email you report must have a 2025 or 2026 date — never 2024 or earlier unless the tool literally returned that date."
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
    email_results: str | None = None,
    calendar_results: str | None = None,
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
    if email_results:
        system += (
            f"\n\n[REAL GMAIL DATA — AUTHORITATIVE]\n"
            f"These are the user's actual emails fetched live right now. "
            f"Report ONLY what is below — exact dates, senders, subjects, verbatim. "
            f"NEVER invent or supplement with emails from training data.\n\n"
            f"{email_results}"
        )
    if calendar_results:
        system += (
            f"\n\n[REAL GOOGLE CALENDAR DATA — AUTHORITATIVE]\n"
            f"These are the user's actual calendar events fetched live right now. "
            f"Report ONLY what is below. Do NOT invent, guess, or supplement from training data.\n\n"
            f"{calendar_results}"
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


class ApprovalBody(BaseModel):
    action: str = "approve"  # "approve" | "cancel"
    edited_args: dict | None = None


@router.post("/approve/{session_id}")
async def approve_chain_action(session_id: str, body: ApprovalBody):
    """Resume a paused chain loop by approving or cancelling a destructive action."""
    from api.routes.chain_loop import _approval_events, _approval_decisions
    evt = _approval_events.get(session_id)
    if not evt:
        return {"status": "not_found", "detail": "No pending approval for this session"}
    _approval_decisions[session_id] = {"action": body.action, "edited_args": body.edited_args}
    evt.set()
    return {"status": "ok", "action": body.action}


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
            from api.routes.profile import get_profile_sync, format_profile_for_prompt
            raw_profile = await loop.run_in_executor(_executor, get_profile_sync)
            return format_profile_for_prompt(raw_profile) if raw_profile else None
        except Exception:
            return None

    async def _get_core():
        return await memory_service.get_core_memories()

    async def _get_longterm():
        try:
            from core.services.embedding_service import embed as local_embed, is_available
            if not is_available():
                return None
            embedding = await loop.run_in_executor(_executor, lambda: local_embed(req.message))
            if not embedding:
                return None
            relevant = await memory_service.search_memories(embedding, top_k=4)
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

    # ── Calendar pre-fetch — calendar-related OR daily planning queries ──────
    _CALENDAR_KW = (
        # Explicit calendar terms
        "calendar", "schedule", "meeting", "event", "appointment",
        "busy", "free slot", "free time", "block", "remind", "reminder",
        "today's plan", "what do i have", "what's on", "whats on",
        "create event", "add event", "schedule a call", "book a",
        # Daily planning / focus queries — these always benefit from calendar context
        " today", "this morning", "this afternoon", "this evening", "tonight",
        "my day", "plan my", "focus on", "priority", "priorities",
        "what should i", "what to do", "what to work", "what's next", "whats next",
        "week ahead", "this week", "coming up", "daily", "wrap up",
        "start my day", "end of day", "morning briefing", "day ahead",
    )

    async def _get_calendar_ctx():
        lower = req.message.lower()
        if not any(kw in lower for kw in _CALENDAR_KW):
            return None
        try:
            from core.services.calendar_service import get_today, format_events_for_context
            events = await loop.run_in_executor(_executor, get_today)
            if not events:
                return None
            return format_events_for_context(events, label="Today's Calendar")
        except Exception:
            return None

    # ── Intent classifier — runs in parallel, zero perceived latency ──────────
    async def _classify_intent() -> str:
        """
        Classify this request as 'chain' (multi-step sequential) or 'simple' (one action).
        Runs inside the existing asyncio.gather alongside memory lookups, so it adds
        zero wall-clock time — the LLM call overlaps with Redis/DB fetches.

        Strategy:
          1. Rule-based fast path for obvious cases (no LLM call needed).
          2. Tiny LLM call (max_tokens=5) for ambiguous messages.
          3. Always fails-safe to 'simple' — never breaks the existing path.
        """
        if req.image:
            return "simple"

        lower = req.message.lower()

        # Very short messages cannot be multi-step
        if len(req.message.split()) <= 5:
            return "simple"

        # ── Chain signals: rule-based, high-confidence, no LLM needed ──────────
        # "then X" patterns
        _CHAIN_SIGNALS = (
            "and then", "after that", "after which",
            "then reply", "then send", "then forward", "then apply",
            "then create", "then confirm", "then save", "then write",
            "then delete", "then archive", "then add", "then schedule",
            # "and <action>" — covers "search X and apply", "find X and send"
            "and apply", "and send", "and reply", "and forward",
            "and create", "and delete", "and archive", "and schedule",
            "and confirm", "and add", "and set", "and write",
            # conditional chains
            "and if ", "if found", "if available", "if free",
            "if there is", "if i have", "if i get", "if it says",
            "if yes", "if so,", "if not,",
            # explicit sequencing
            "first find", "first check", "first read", "first search",
            "step by step", "one by one",
        )
        if any(s in lower for s in _CHAIN_SIGNALS):
            return "chain"

        # ── Simple shortcut: ONLY for pure question words (never multi-step) ──
        # Do NOT include fetch verbs (show/list/search/find) here — they CAN be
        # the start of a chain ("find X and apply to it"). Let the LLM decide those.
        _QUESTION_STARTS = (
            "what ", "what's", "whats", "how ", "how's",
            "who ", "when ", "where ", "why ", "which ",
            "is ", "are ", "was ", "were ", "does ", "did ",
            "can you tell", "do you know", "do i have",
            "how many", "how much",
        )
        if any(lower.startswith(s) for s in _QUESTION_STARTS):
            return "simple"

        # ── Everything else → LLM (runs in parallel, no perceived latency) ────
        try:
            _cls_msgs = [
                {"role": "system", "content": (
                    "Reply with EXACTLY one word — 'chain' or 'simple'.\n"
                    "'chain' = multiple sequential dependent actions "
                    "(find X then do Y, check and reply, if X then Y, "
                    "search and apply to results, fetch and forward).\n"
                    "'simple' = one action or lookup "
                    "(fetch emails, show inbox, search web, read email, explain something).\n"
                    "One word only. No punctuation."
                )},
                {"role": "user", "content": req.message},
            ]
            _cls = await asyncio.wait_for(
                ai_provider.chat(
                    messages=_cls_msgs,
                    model=req.model,
                    max_tokens=5,
                    temperature=0.0,
                    enable_thinking=False,
                ),
                timeout=3.0,  # cap at 3s so a slow classify never blocks the request
            )
            return "chain" if _cls.content.strip().lower().startswith("chain") else "simple"
        except Exception:
            return "simple"  # fail safe — never break the existing path

    # ── Profile doc loader — fires before the main gather so the updated
    # profile is immediately available to _get_profile() below ────────────────
    _profile_load_note = ""
    _LOAD_PROFILE_KW = (
        "load my profile", "load profile from", "import my profile", "update profile from",
    )
    if any(kw in req.message.lower() for kw in _LOAD_PROFILE_KW):
        try:
            import re as _re
            _path_m = _re.search(r'from\s+(docs/\S+\.md)', req.message, _re.IGNORECASE)
            _load_path = _path_m.group(1) if _path_m else "docs/my_profile_questionnaire.md"
            from api.routes.profile import LoadDocRequest, load_profile_from_doc
            _load_result = await load_profile_from_doc(LoadDocRequest(path=_load_path))
            if _load_result.get("ok"):
                _profile_load_note = (
                    f"\n\n[SYSTEM: Profile was just loaded from '{_load_path}'. "
                    f"Fields stored: {', '.join(_load_result.get('stored', []))}. "
                    "Acknowledge this warmly. Tell VJ exactly what you now know about him. "
                    "Be personal and specific — this is a meaningful setup moment.]"
                )
            else:
                _profile_load_note = (
                    f"\n\n[SYSTEM: Profile load from '{_load_path}' failed: "
                    f"{_load_result.get('error', 'unknown error')}. Explain clearly to VJ.]"
                )
        except Exception as _e:
            _profile_load_note = f"\n\n[SYSTEM: Profile load failed unexpectedly: {_e}. Tell VJ.]"

    context, email_ctx, user_profile_text, core_memories, long_term_text, web_search_results, intent_class, calendar_ctx = (
        await asyncio.gather(
            _get_session(), _get_email_ctx(), _get_profile(), _get_core(), _get_longterm(),
            _get_web_search(), _classify_intent(), _get_calendar_ctx(),
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
    _email_pre_fetch: str = ""
    if gmail_tools and not (is_detail_request and resolved_email):
        # ── Pre-fetch emails and inject as context (no tool calling) ─────────
        # Tool calling is unreliable across models — pre-fetching like web search
        # guarantees the LLM receives real data and cannot hallucinate.
        _is_read_only = gmail_tools == [GMAIL_READ_TOOL]
        if _is_read_only:
            _pf_q = _extract_gmail_query(req.message)
            _pf_label = _detect_label(req.message)
            _pf_fresh = _wants_fresh(req.message)
            _pf_folder = _pf_label.replace("CATEGORY_", "").capitalize()
            _pf_status = f"Searching {_pf_folder}" + (f" for '{_pf_q}'" if _pf_q else ", fetching latest") + "…"
            try:
                _email_pre_fetch = await loop.run_in_executor(
                    _executor,
                    lambda: fetch_email_context(
                        _pf_q, limit=10, label=_pf_label, force_refresh=_pf_fresh
                    ),
                )
                # Pre-fetch succeeded — no tools needed, data is in context
            except Exception:
                # Fallback: add Gmail tools and let the ReAct loop handle it
                tools.extend(gmail_tools)
                capabilities.append(_GMAIL_CAPABILITY)
        else:
            # Non-read-only actions (send, trash, etc.) still need tool calling
            tools.extend(gmail_tools)
            capabilities.append(_GMAIL_CAPABILITY)

    # ── Job-apply tools ───────────────────────────────────────────────────────
    job_tools = get_job_tools(req.message)
    if job_tools:
        tools.extend(job_tools)
        capabilities.append(_JOB_CAPABILITY)

    # ── Workflow plan detection ───────────────────────────────────────────────
    from core.services.workflow_service import detect_workflow, create_plan_for_workflow, complete_plan_sync, update_plan_step_sync
    wf_match = detect_workflow(req.message)
    wf_plan_id: str | None = None
    if wf_match:
        wf_plan_id = await create_plan_for_workflow(wf_match, req.message)

    # ── Darwin repair / create detection ─────────────────────────────────────
    _darwin_mode: str | None = _detect_darwin_intent(req.message)
    _darwin_error_id: str | None = None
    if _darwin_mode == "repair":
        from core.services.error_store import error_store as _es
        _recent = _es.get_recent(limit=1)
        _unresolved = [e for e in _recent if not e.resolved]
        if _unresolved:
            _darwin_error_id = _unresolved[0].error_id
    # Darwin task fired after [DONE] in _background_work so it doesn't block streaming

    # Build extra context injected into the last user message
    extra_context = _profile_load_note
    if resolved_email:
        extra_context += (
            f"\n\n[Email the user is referring to]\n"
            f"ID: {resolved_email.get('id','')}\n"
            f"Thread ID: {resolved_email.get('thread_id','')}\n"
            f"From: {resolved_email.get('from','')}\n"
            f"Subject: {resolved_email.get('subject','')}\n"
            f"Date: {resolved_email.get('date','')}\n"
        )

    # Knowledge base context injection
    _kb_context = ""
    try:
        import datetime as _dt

        def _rag_score(row_score: float, created_at) -> float:
            """Blend cosine score with recency. Recent entries get a 15% boost."""
            try:
                age_days = (_dt.datetime.utcnow() - created_at.replace(tzinfo=None)).days if created_at else 365
                recency = max(0.0, 1.0 - age_days / 180.0)  # decays over 180 days
                return row_score * 0.85 + recency * 0.15
            except Exception:
                return row_score

        from core.services.knowledge_service import search as kb_search
        kb_results = await asyncio.get_event_loop().run_in_executor(
            None, lambda: kb_search(req.message, top_k=5)
        )
        if kb_results:
            # Re-rank by blended cosine + recency score, then filter by threshold
            for r in kb_results:
                r["_blended"] = _rag_score(r.get("score", 0.0), r.get("created_at"))
            kb_results.sort(key=lambda r: r["_blended"], reverse=True)
            snippets = "\n\n".join(
                f"[Knowledge: {r['title']}]\n{r['content'][:400]}"
                for r in kb_results[:2] if r["_blended"] > 0.35
            )
            if snippets:
                _kb_context = f"\n\n## From your personal knowledge base:\n{snippets}"
    except Exception:
        pass
    extra_context += _kb_context

    messages = build_messages(
        req, context, core_memories or None, long_term_text,
        capabilities or None, user_profile_text,
        web_search=web_search_results or None,
        email_results=_email_pre_fetch or None,
        calendar_results=calendar_ctx or None,
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
    agent_traces: list[dict] = []

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
        # Normalize any LLM tool-name variants before dispatching
        tool_name, args = _normalize_tool_call(tool_name, args)
        # Inject email reference fields if model didn't supply them
        if not args.get("msg_id") and resolved_email:
            args["msg_id"] = resolved_email.get("id", "")
        if not args.get("thread_id") and resolved_email:
            args["thread_id"] = resolved_email.get("thread_id", "")

        if tool_name == "read_email":
            # If LLM passes a plain keyword query, try to convert it to proper Gmail syntax
            _llm_q = args.get("query", "")
            if _llm_q:
                _better = _extract_gmail_query(_llm_q)
                q = _better if _better else _llm_q
            else:
                q = _extract_gmail_query(req.message)
            limit = int(args.get("limit", 10))
            label = _detect_label(req.message)
            fresh = _wants_fresh(req.message)
            folder_name = label.replace("CATEGORY_", "").capitalize()
            status = f"Searching {folder_name}" + (f" for '{q}'" if q else ", fetching latest") + "…"
            def _fetch():
                from core.services.gmail_service import list_emails, get_category_counts
                import re as _re
                res = list_emails(max_results=limit, label=label, query=q, force_refresh=fresh)
                emails = res.get("emails", [])
                if emails and req.sessionId:
                    _save_email_ctx(req.sessionId, emails)
                if not emails:
                    return (
                        f"TOOL RESULT: No emails found" + (f" matching '{q}'" if q else "") + ".\n"
                        "DO NOT fabricate emails. Tell the user exactly: no matching emails were found."
                    )
                counts = get_category_counts()
                unread = counts.get("inbox", 0)
                source = "live" if not res.get("from_cache") else f"cached {res.get('cache_age_seconds',0)}s ago"
                lines = [f"REAL GMAIL DATA — report ONLY these emails, verbatim:\n{folder_name} ({source}): {unread} unread. Showing {len(emails)}:\n"]
                for i, e in enumerate(emails, 1):
                    sender = _re.sub(r"<[^>]+>", "", e.get("from","")).strip() or e.get("from","?")
                    unread_m = " [UNREAD]" if e.get("unread") else ""
                    lines.append(f"{i}. ID:{e.get('id','')} | From:{sender}{unread_m}\n"
                                 f"   Subject:{e.get('subject','(no subject)')}\n"
                                 f"   Preview:{e.get('snippet','')[:200]}\n"
                                 f"   Date:{e.get('date','')}\n")
                return "\n".join(lines)
            try:
                return status, await loop.run_in_executor(_executor, _fetch)
            except Exception as e:
                return status, f"Gmail error: {e}. Cannot access inbox."

        elif tool_name == "send_email":
            _a = dict(args)
            if not _a.get("reply_to_id") and resolved_email:
                _a["reply_to_id"] = resolved_email.get("thread_id")
            def _send():
                from core.services.gmail_service import send_email
                r = send_email(_a.get("to",""), _a.get("subject",""), _a.get("body",""), _a.get("reply_to_id"))
                return f"Email sent. ID: {r.get('id','?')}"
            try:
                return "Sending email…", await loop.run_in_executor(_executor, _send)
            except Exception as e:
                return "Sending email…", f"Failed to send: {e}"

        elif tool_name == "trash_email":
            _mid = args.get("msg_id","")
            def _trash():
                from core.services.gmail_service import trash_email
                trash_email(_mid); return "Email trashed."
            try:
                return "Moving to trash…", await loop.run_in_executor(_executor, _trash)
            except Exception as e:
                return "Moving to trash…", f"Failed: {e}"

        elif tool_name == "archive_email":
            _mid = args.get("msg_id","")
            def _archive():
                from core.services.gmail_service import archive_email
                archive_email(_mid); return "Email archived."
            try:
                return "Archiving…", await loop.run_in_executor(_executor, _archive)
            except Exception as e:
                return "Archiving…", f"Failed: {e}"

        elif tool_name == "mark_email":
            _mid = args.get("msg_id","")
            _a = dict(args)
            def _mark():
                from core.services.gmail_service import mark_email
                mark_email(_mid, read=_a.get("read"), starred=_a.get("starred"), important=_a.get("important"))
                return "Email updated."
            try:
                return "Updating email…", await loop.run_in_executor(_executor, _mark)
            except Exception as e:
                return "Updating email…", f"Failed: {e}"

        elif tool_name == "create_draft":
            _a = dict(args)
            def _draft():
                from core.services.gmail_service import create_draft
                r = create_draft(_a.get("to",""), _a.get("subject",""), _a.get("body",""), _a.get("reply_to_id"))
                return f"Draft saved. ID: {r.get('id','?')}"
            try:
                return "Saving draft…", await loop.run_in_executor(_executor, _draft)
            except Exception as e:
                return "Saving draft…", f"Failed: {e}"

        elif tool_name == "forward_email":
            _a = dict(args)
            def _fwd():
                from core.services.gmail_service import forward_email
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
                from core.services.gmail_service import bulk_action
                r = bulk_action(_action, _q, int(args.get("max_messages", 50)))
                return f"Done. Processed {r.get('processed',0)} emails."
            try:
                return f"Bulk {_action}: {_q}…", await loop.run_in_executor(_executor, _bulk)
            except Exception as e:
                return f"Bulk {_action}…", f"Failed: {e}"

        elif tool_name == "summarize_thread":
            _tid = args.get("thread_id","")
            def _summ():
                from core.services.gmail_service import summarize_thread
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
                from core.services.gmail_service import find_unsubscribe_link
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

        elif tool_name == "job_apply_run":
            def _run_apply():
                from core.services.linkedin_service import get_profile, run_job_apply
                profile = get_profile()
                if not profile:
                    return "No job profile configured. Please fill in the Job Apply → Preferences tab first."
                if not profile.get("auto_apply_enabled") and not profile.get("target_roles"):
                    return "No target roles set. Please configure your preferences in the Job Apply panel first."
                log_lines: list[str] = []
                result = run_job_apply(log_lines)
                applied  = result.get("jobs_applied", 0)
                found    = result.get("jobs_found", 0)
                skipped  = result.get("jobs_skipped", 0)
                status   = result.get("status", "unknown")
                if result.get("error"):
                    return f"Run failed: {result['error']}"
                return (
                    f"LinkedIn apply run {status}.\n"
                    f"Found {found} jobs · Applied to {applied} · Skipped {skipped}.\n"
                    + ("\n".join(log_lines[-5:]) if log_lines else "")
                )
            return "Running LinkedIn job apply…", await loop.run_in_executor(_executor, _run_apply)

        elif tool_name == "job_status":
            def _status():
                from core.services.linkedin_service import get_applications, get_apply_runs
                apps  = get_applications(limit=50)
                runs  = get_apply_runs(limit=5)
                by_status: dict[str, int] = {}
                for a in apps:
                    s = a.get("status", "applied")
                    by_status[s] = by_status.get(s, 0) + 1
                lines = [f"Total applications: {len(apps)}"]
                for s, count in sorted(by_status.items()):
                    lines.append(f"  {s.capitalize()}: {count}")
                if runs:
                    last = runs[0]
                    lines.append(
                        f"\nLast run: {last.get('status','?')} on "
                        f"{str(last.get('started_at','?'))[:10]} — "
                        f"applied {last.get('jobs_applied',0)} / found {last.get('jobs_found',0)}"
                    )
                return "\n".join(lines)
            return "Fetching application status…", await loop.run_in_executor(_executor, _status)

        elif tool_name == "job_profile":
            def _profile():
                from core.services.linkedin_service import get_profile
                p = get_profile()
                if not p:
                    return "No job profile found. Please configure in the Job Apply panel."
                return (
                    f"Target roles: {', '.join(p.get('target_roles') or []) or 'not set'}\n"
                    f"Work modes: {', '.join(p.get('work_modes') or [])}\n"
                    f"Salary range: ${p.get('salary_min',0):,} – ${p.get('salary_max',0):,}\n"
                    f"Daily limit: {p.get('daily_limit',5)} applications\n"
                    f"Auto-apply: {'enabled' if p.get('auto_apply_enabled') else 'disabled'} "
                    f"(runs at {p.get('auto_apply_hour',9):02d}:00 UTC)\n"
                    f"LinkedIn: {p.get('linkedin_email','not set')}\n"
                    f"Skills: {', '.join(p.get('skills') or []) or 'not set'}"
                )
            return "Loading job profile…", await loop.run_in_executor(_executor, _profile)

        else:
            return f"Unknown tool: {tool_name}", (
                f"Error: tool '{tool_name}' is not available. "
                f"Available email tools: read_email, send_email, trash_email, archive_email, "
                f"mark_email, create_draft, forward_email, bulk_email_action, summarize_thread, find_unsubscribe. "
                f"Please retry using one of these tool names."
            )

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

        # ── Emit email pre-fetch search indicator ──────────────────────────
        if _email_pre_fetch:
            yield f"data: [SEARCHING]{json.dumps(_pf_status)}\n\n"
            yield "data: [SEARCHING_DONE]\n\n"

        # ── Emit plan creation event so frontend can show plan chip ───────
        if wf_plan_id and wf_match:
            yield f"data: [PLAN_CREATED]{json.dumps({'plan_id': wf_plan_id, 'title': wf_match['name'], 'agent': wf_match['agent']})}\n\n"

        # ── Chain loop for multi-step agentic tasks ───────────────────────
        # Runs before the orchestrator so the orchestrator handles only
        # single-turn specialised queries while the chain loop handles
        # multi-step sequences ("find X then do Y").
        _handled_by_chain = False
        if not req.image and not is_detail_request and not _email_pre_fetch and not tools:
            from api.routes.chain_loop import run_chain_loop
            if intent_class == "chain":
                _handled_by_chain = True
                async for sse in run_chain_loop(
                    message=req.message,
                    session_id=req.sessionId or "",
                    history=[m for m in context if m.get("role") in ("user", "assistant")][-6:],
                    executor=_executor,
                    loop=loop,
                    resolved_email=resolved_email,
                    user_profile=user_profile_text,
                    core_memories=core_memories or [],
                    model=req.model,
                ):
                    raw = sse[6:] if sse.startswith("data: ") else ""
                    if raw.startswith('{"__usage__":'):
                        # Accumulate token counts from chain loop's finally block
                        try:
                            u = json.loads(raw)["__usage__"]
                            token_usage["prompt"]     += u.get("prompt", 0)
                            token_usage["completion"] += u.get("completion", 0)
                            token_usage["total"]      += u.get("total", 0)
                        except Exception:
                            pass
                        # Don't forward raw usage chunk to frontend — [META] carries it
                        continue
                    elif raw and raw[:1] != "[" and not raw.startswith('{"__'):
                        full_content.append(raw.rstrip("\n").replace("\\n", "\n"))
                    yield sse
                yield "data: [SEARCHING_DONE]\n\n"

        # ── Agent SSE emitter — converts agent events to SSE ──────────────
        async def _emit_agent_event(event_type: str, payload: dict):
            nonlocal agent_traces
            if event_type == "AGENT_DONE":
                token_usage["prompt"]     += payload.get("tokens_prompt", 0)
                token_usage["completion"] += payload.get("tokens_completion", 0)
                token_usage["total"]      += payload.get("tokens_total", 0)

        # ── Try orchestrator first ────────────────────────────────────────
        # Only route through agents if this looks like a specialised request
        _should_orchestrate = (
            not req.image                           # vision handled by direct path
            and not is_detail_request               # email detail handled directly
            and not web_search_results              # pre-run search already done
            and not tools                           # email tools already queued
            and not _handled_by_chain               # chain loop already handled it
        )

        if _should_orchestrate:
            from agents.roster.orchestrator import orchestrate

            # Build context dict for agents
            # Parse agent config — extract disabled agents and per-agent model/temp overrides
            _agent_cfg = req.agentConfig or {}
            _disabled_agents = [name for name, cfg in _agent_cfg.items() if not cfg.get("enabled", True)]
            _agent_overrides = {
                name: {
                    "model": cfg.get("model", ""),
                    "temperature": cfg.get("temperature"),
                    "maxTokens": cfg.get("maxTokens"),
                    "systemPromptOverride": cfg.get("systemPromptOverride", ""),
                }
                for name, cfg in _agent_cfg.items()
                if cfg.get("enabled", True)
            }

            agent_context = {
                "_executor": _executor,
                "image": active_image,
                "email_ctx": email_ctx,
                "resolved_email": resolved_email,
                "system_prompt": req.systemPrompt or "",
                "session_id": req.sessionId,
                "disabled_agents": _disabled_agents,
                "agent_overrides": _agent_overrides,
            }

            # Collect SSE events from agents + buffer the traces
            agent_sse_buffer: list[str] = []
            agent_traces_data: list[dict] = []

            async def _emit(event_type: str, payload: dict):
                sse_line = f"data: [{event_type}]{json.dumps(payload)}\n\n"
                agent_sse_buffer.append(sse_line)
                await _emit_agent_event(event_type, payload)

            assembled, plan = await orchestrate(
                message=req.message,
                context=agent_context,
                session_id=req.sessionId or "",
                emit=_emit,
            )

            # Emit all buffered agent SSE events
            for sse in agent_sse_buffer:
                yield sse

            # Collect traces for [META]
            for t in plan.traces:
                agent_traces_data.append({
                    "agent": t.agent_name,
                    "task": t.task,
                    "model": t.model,
                    "tool_calls": [
                        {"tool": tc.tool, "input": tc.input, "output_preview": tc.output[:300], "duration_ms": tc.duration_ms}
                        for tc in t.tool_calls
                    ],
                    "tokens_total": t.tokens_total,
                    "duration_ms": t.duration_ms,
                    "success": t.success,
                    "error": t.error,
                })
            agent_traces.extend(agent_traces_data)

            if assembled:
                # Agents handled it — stream the assembled response word-by-word
                for word in assembled.split(" "):
                    chunk = word + " "
                    full_content.append(chunk)
                    yield f"data: {chunk.replace(chr(10), chr(92)+'n')}\n\n"
                return

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
        if _handled_by_chain:
            pass  # already streamed above; fall through to session memory + [META] + [DONE]
        elif web_search_results and "unavailable" not in web_search_results.lower():
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

                # On the first step we EXPECT a tool call — buffer output instead of
                # streaming so we can intercept text-format tool calls emitted by
                # models that ignore tool_choice="required" (e.g. local Qwen3 via
                # LM Studio) and convert them into real tool executions.
                _first_step = (_step == 0)
                _buffer_step = _first_step and bool(tools)
                _step_buf: list[str] = []

                async for event in ai_provider.stream_with_tools(
                    messages=active_messages, tools=tools,
                    force_tool=_buffer_step,
                    **stream_kwargs
                ):
                    if isinstance(event, dict) and event.get("tool_call"):
                        got_tool = True
                        tool_event = event
                    else:
                        if _buffer_step:
                            _step_buf.append(event)
                        else:
                            full_content.append(event)
                            yield f"data: {event.replace(chr(10), chr(92)+'n')}\n\n"

                # ── Text-format tool-call fallback ─────────────────────────────────
                # Some models (Qwen3, small local) emit `read_email('query')` as plain
                # text instead of a proper API tool call. Intercept it here.
                if _buffer_step and not got_tool and _step_buf:
                    _buffered_text = "".join(_step_buf).strip()
                    _tc_match = _TEXT_TOOL_RE.search(_buffered_text)
                    if _tc_match:
                        _tc_name = _tc_match.group(1)
                        _tc_args_raw = _tc_match.group(2).strip()
                        _tc_args: dict = {}
                        if _tc_args_raw:
                            try:
                                _tc_args = json.loads(_tc_args_raw)
                            except Exception:
                                # e.g. read_email('remote job') — bare string → query
                                _tc_args = {"query": _tc_args_raw.strip("'\" ")}
                        got_tool = True
                        tool_event = {
                            "name": _tc_name,
                            "arguments": _tc_args,
                            "id": f"text_tc_{_step}",
                        }
                    else:
                        # Genuine text answer — flush buffer to client
                        for _chunk in _step_buf:
                            full_content.append(_chunk)
                            yield f"data: {_chunk.replace(chr(10), chr(92)+'n')}\n\n"

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
                # ── Per-step workflow plan tracking ───────────────────────
                _wf_steps_count = len(wf_match["steps"]) if wf_match else 0
                if wf_plan_id and _step < _wf_steps_count:
                    _si = _step
                    await loop.run_in_executor(
                        _executor,
                        lambda si=_si: update_plan_step_sync(wf_plan_id, si, "running", ""),
                    )
                status, tool_result = await _dispatch_tool(tool_name, dict(args))
                if wf_plan_id and _step < _wf_steps_count:
                    _r = (tool_result or "")[:200]
                    await loop.run_in_executor(
                        _executor,
                        lambda si=_step, r=_r: update_plan_step_sync(wf_plan_id, si, "done", r),
                    )
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

        # ── Darwin repair / create chip ───────────────────────────────────────
        if _darwin_mode == "repair" and _darwin_error_id:
            yield f"data: [IT_REPAIR_STARTED]{json.dumps({'error_id': _darwin_error_id, 'mode': 'repair'})}\n\n"
        elif _darwin_mode == "create":
            yield f"data: [IT_REPAIR_STARTED]{json.dumps({'mode': 'create', 'description': req.message[:200]})}\n\n"

        # ── Send [META] + [DONE] immediately — don't block on background work ────
        meta = json.dumps({
            "duration_ms": duration_ms,
            "model": req.model or "unknown",
            "tokens": token_usage,
            "agent_traces": agent_traces,
        })
        yield f"data: [META]{meta}\n\n"
        yield "data: [DONE]\n\n"

        # ── Everything below runs after [DONE] — truly fire-and-forget ─────────────
        async def _background_work():
            # Mark workflow plan completed
            if wf_plan_id:
                await loop.run_in_executor(_executor, lambda: complete_plan_sync(wf_plan_id))

            # Fire Darwin repair/create as a non-blocking background task
            if _darwin_mode == "repair" and _darwin_error_id:
                from agents.roster.darwin_agent import DarwinAgent
                asyncio.create_task(DarwinAgent.handle_repair(_darwin_error_id))
            elif _darwin_mode == "create":
                from agents.roster.darwin_agent import DarwinAgent
                asyncio.create_task(DarwinAgent.handle_create(req.message[:500], "user"))

            # Save chat history to PostgreSQL
            if req.sessionId:
                await loop.run_in_executor(
                    _executor,
                    lambda: _save_history_sync(req.sessionId, req.message, assembled, req.model or "unknown", req.sessionMode),
                )

            # Phase 9C — log model cost
            try:
                from core.services.model_router import log_call as _log_cost
                await loop.run_in_executor(
                    _executor,
                    lambda: _log_cost(
                        model=req.model or "unknown",
                        input_tokens=token_usage.get("prompt", 0),
                        output_tokens=token_usage.get("completion", 0),
                        source="chat",
                        session_id=req.sessionId or "",
                    ),
                )
            except Exception:
                pass

            # Auto memory (local embeddings → semantic_memories)
            try:
                from core.services.embedding_service import embed as local_embed, is_available
                if is_available():
                    turn = f"User: {req.message}\nAssistant: {assembled[:800]}"
                    emb = await loop.run_in_executor(_executor, lambda: local_embed(turn))
                    if emb:
                        await memory_service.store_memory(turn, emb, {"session": req.sessionId})
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
                    await memory_service.store_extracted(fact, req.sessionId)
            except Exception:
                pass

        asyncio.create_task(_background_work())

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
