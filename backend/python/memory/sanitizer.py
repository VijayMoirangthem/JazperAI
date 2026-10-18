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
    _Rule("PASSWORD", re.compile(r"(?i)\b(?:pass(?:word|wd|code)?|pwd|secret|token|api[_ -]?key)\s*(?:is|[:=])\s*[^\s,;]{4,}")),
    _Rule("AADHAAR", re.compile(r"(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)"), lambda t: _verhoeff(_digits(t))),
    _Rule("PAN", re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")),
    _Rule("CARD", re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)"), lambda t: 13 <= len(_digits(t)) <= 19 and _luhn(_digits(t))),
    _Rule("UPI_ID", re.compile(r"\b[A-Za-z0-9._\-]{2,}@(?!(?:gmail|yahoo|outlook|hotmail)\b)[A-Za-z]{2,}\b(?!\.)")),
]

_PRESIDIO = ["EMAIL_ADDRESS", "PHONE_NUMBER", "IBAN_CODE", "IP_ADDRESS"]
_engine = None
_engine_failed = False


def _presidio():
    global _engine, _engine_failed
    if _engine is not None or _engine_failed:
        return _engine
    try:
        from presidio_analyzer import AnalyzerEngine
        from presidio_analyzer.nlp_engine import NlpEngineProvider
        nlp = NlpEngineProvider(nlp_configuration={
            "nlp_engine_name": "spacy", "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}]}).create_engine()
        _engine = AnalyzerEngine(nlp_engine=nlp, supported_languages=["en"])
    except Exception as e:  # presidio/spacy model missing -> regex-only mode
        _engine_failed = True
        log.warning("presidio unavailable, regex-only sanitizer", error=str(e))
    return _engine


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
    eng = _presidio()
    if eng is not None:
        res = sorted(eng.analyze(text=text, language="en", entities=_PRESIDIO, score_threshold=0.5),
                     key=lambda x: x.start, reverse=True)
        for x in res:
            found.add(x.entity_type)
            text = text[:x.start] + f"<{x.entity_type}>" + text[x.end:]
    return text, sorted(found)
