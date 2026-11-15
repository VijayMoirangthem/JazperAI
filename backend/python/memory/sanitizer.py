"""PII / secret sanitizer — runs BEFORE embedding or persisting memory text (spec §4, §15, §25).

Pass 1: custom India-specific + secret recognizers (regex + checksum validators), highest priority.
Pass 2: Microsoft Presidio built-ins (email, phone, IBAN, IP, card) when available.
Replaces matches with typed placeholders like <AADHAAR>; returns the entity types found.
"""
import re
from dataclasses import dataclass

import structlog

log = structlog.get_logger()

# Verhoeff tables (Aadhaar checksum)
_D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],
      [5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
_P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],
      [4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]


def _verhoeff(num: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(num)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


def _luhn(num: str) -> bool:
    s, alt = 0, False
    for ch in reversed(num):
        d = int(ch)
        if alt:
            d = d * 2 - 9 if d * 2 > 9 else d * 2
        s += d
        alt = not alt
    return s % 10 == 0


def _digits(m: str) -> str:
    return re.sub(r"\D", "", m)


@dataclass(frozen=True)
class _Rule:
    entity: str
    pattern: re.Pattern
    validate: object = None  # callable(match_text) -> bool


_RULES = [
    # secrets first so they win over generic patterns
    _Rule("API_KEY", re.compile(r"\b(?:sk-ant-[A-Za-z0-9_\-]{20,}|sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|"
                                r"gh[pousr]_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9\-]{10,}|AIza[0-9A-Za-z_\-]{35})\b")),
    _Rule("JWT", re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b")),
    _Rule("BEARER_TOKEN", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{16,}")),
    _Rule("PASSWORD", re.compile(r"(?i)\b(?:pass(?:word|wd|code)?|pwd|pw|secret|token|api[_ -]?key)\s*(?:is|[:=])\s*[^\s,;]{4,}")),
    _Rule("AADHAAR", re.compile(r"(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)"), lambda t: _verhoeff(_digits(t))),
    _Rule("PAN", re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")),
    _Rule("CARD", re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)"), lambda t: 13 <= len(_digits(t)) <= 19 and _luhn(_digits(t))),
    # regex only (no local NLP model: cloud models only), so email/phone/IP/IBAN/UPI never reach memory in clear text
    _Rule("EMAIL_ADDRESS", re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}\b")),
    _Rule("IBAN_CODE", re.compile(r"\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9]{4}[ ]?){2,7}[A-Z0-9]{1,4}\b")),
    _Rule("IP_ADDRESS", re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")),
    _Rule("PHONE_NUMBER", re.compile(r"(?<![\w.])(?:\+\d{1,3}[ -]?\d{4,5}[ -]?\d{4,6}|[6-9]\d{4}[ -]?\d{5}|\(?\d{3}\)?[ -]\d{3}[ -]\d{4})(?![\w.])"), lambda t: 10 <= len(_digits(t)) <= 15),
    _Rule("UPI_ID", re.compile(r"\b[A-Za-z0-9._\-]{2,}@(?!(?:gmail|yahoo|outlook|hotmail)\b)[A-Za-z]{2,}\b(?!\.)")),
]

def sanitize(text: str) -> tuple[str, list[str]]:
    """Return (clean_text, sorted unique entity types found)."""
    found: set[str] = set()
    for r in _RULES:
        def _sub(m, r=r):
            if r.validate and not r.validate(m.group(0)):
                return m.group(0)
            found.add(r.entity)
            return f"<{r.entity}>"
        text = r.pattern.sub(_sub, text)
    return text, sorted(found)
