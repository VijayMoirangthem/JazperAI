"""Which kind of turn is this? Decides, with no model call, whether a message needs Jasper's tools or is plain conversation.

Plain conversation ("hi", "how are you", "explain X", "kya haal hai") is answered straight away with a short prompt and a low
reasoning effort (~0.3-0.5 s). Anything that might touch email, files, the team, the system or the outside world goes through the full
tool loop. When in doubt the answer is "needs tools": a wrongly-plain message is the only risky mistake, and `tool_subset` and the
guard in chat2 (fall back if the model tries to call a tool) cover it.
"""
from __future__ import annotations

import re
from datetime import datetime

# Words that suggest an action or live data. English, Hinglish (Roman) and Hindi (Devanagari).
_TOOLY = re.compile(
    r"\b(e-?mails?|mails?|gmail|inbox|drive|docs?|documents?|sheets?|slides?|files?|folders?|calendar|meetings?|remind(?:er)?s?|schedule|"
    r"search|google|web|news|weather|prices?|stocks?|open|connect(?:ors?|ions?)?|integrations?|bots?|agents?|team|delegate|status|health|"
    r"usage|tokens?|errors?|logs?|remember|skills?|run|build|code|deploy|workspace|git|read|write|send|delete|create|find|latest|show|list|"
    r"check|clear|diagnose|fix|install|download|upload|share|attach(?:ment)?s?|invoice|payment|"
    r"dikhao|dikha|dikhana|bhejo|bhej|khojo|dhundo|padho|likho|banao|hatao|mita|kholo|jodo|batao|bata|check|sunao|"
    r"kal|parso)\b|[ऀ-ॿ]*(ईमेल|मेल|फाइल|फ़ाइल|दिखा|भेज|खोज|ढूंढ|पढ़|लिख|बना|हटा|खोल|जोड़|बता|याद|कैलेंडर|मीटिंग)",
    re.I,
)
MAX_WORDS = 28


def needs_tools(text: str, has_attachments: bool = False) -> bool:
    """True when the message should go through the full tool loop."""
    t = (text or "").strip()
    if not t or has_attachments or len(t) > 400:
        return True
    if len(t.split()) > MAX_WORDS:
        return True
    if "://" in t or "@" in t or "```" in t:      # links, addresses and code blocks usually mean work
        return True
    return bool(_TOOLY.search(t))


def plain_system(system: str, now: datetime | None = None) -> str:
    """The persona + memory + language line that chat2 already built, plus the current date/time (the model has no clock) and the style rule."""
    now = now or datetime.now().astimezone()
    return (f"{system}\n\nCurrent date and time: {now.strftime('%A, %d %B %Y, %H:%M')} ({now.tzname() or 'local'}).\n"
            "Style: casual, short, straight to the point (1-2 sentences, no greetings, no apologies, no menus of options). "
            "You have no tools in this reply: if the founder is really asking you to DO something (email, files, team, system), "
            "answer with exactly the word TOOLS and nothing else.")


def is_escalation(text: str) -> bool:
    """The plain model said it needs tools (or tried to call one): the caller must fall back to the full tool loop."""
    h = (text or "").lstrip()
    return h.startswith(("<tool", "{", "[")) or h.upper().startswith("TOOLS")


# ── tool subset (1.3): fewer tool descriptions in the prompt for a message that is clearly about one area ──────────────
_FS = ["fs_roots", "fs_list", "fs_read", "fs_search", "fs_write"]
DOMAINS: dict[str, tuple[re.Pattern, list[str]]] = {
    "files": (re.compile(r"\b(drive|docs?|documents?|sheets?|slides?|files?|folders?|spreadsheet|pdf|open|upload|download|share)\b|फाइल|फ़ाइल", re.I),
              ["google", "open_file", "find_file", "list_connections", "capability_plan"]),
    "system": (re.compile(r"\b(status|health|usage|tokens?|errors?|logs?|alerts?|slo|diagnose|provider|models?|slow|down|broken|fix)\b", re.I),
               ["system_status", "llm_status", "llm_fix", "read_logs", "alerts", "slo", "diagnose", "gaps"]),
    "team": (re.compile(r"\b(bots?|agents?|team|org|delegate|meeting|hire|interview|evaluate|improve|prompt)\b", re.I),
             ["list_org", "find_bot", "hold_meeting", "bot_stats", "create_bot", "edit_bot_prompt", "evaluate_bot", "improve_bot"]),
    "build": (re.compile(r"\b(build|feature|code|deploy|merge|branch|workspace|repo|git)\b", re.I),
              ["build_feature", "feature_status", "merge_feature", *_FS]),
    "memory": (re.compile(r"\b(remember|memory|skills?|forget|note)\b|याद", re.I),
               ["remember", "list_skills", "view_skill", "save_skill"]),
    "connect": (re.compile(r"\b(connect(?:ors?|ions?)?|integrations?|plug-?in|smarter|upgrade)\b", re.I),
                ["list_connections", "suggest_connectors", "capability_plan"]),
    "chat": (re.compile(r"\b(clear chat|clear the chat|delete (this )?chat)\b", re.I), ["clear_chat"]),
}
CORE = ["ask_bot", "capability_plan", "find_bot"]   # always offered: delegation covers anything the subset misses


def tool_subset(text: str, allowed: list[str]) -> list[str] | None:
    """The tools to DESCRIBE for this message, or None for 'describe all'. Only descriptions shrink: every allowed tool can still be called."""
    t = text or ""
    picked: list[str] = []
    hit = 0
    for _name, (rx, tools) in DOMAINS.items():
        if rx.search(t):
            hit += 1
            picked += tools
    if hit == 0 or hit >= 4:       # no clear area, or it spans many: show everything
        return None
    wanted = [x for x in dict.fromkeys([*CORE, *picked]) if x in allowed]
    return wanted if 0 < len(wanted) < len(allowed) else None
