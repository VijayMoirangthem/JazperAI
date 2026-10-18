"""Phase 9C — Multi-Model Router
Classifies task complexity and recommends a model tier.
Also provides cost-logging utilities for tracking LLM spend.
"""
from __future__ import annotations
import re
import psycopg2
import structlog
from core.config import settings as s

log = structlog.get_logger()

# ── Groq pricing (USD per 1M tokens, 2025 estimates) ─────────────────────────
_PRICING: dict[str, tuple[float, float]] = {
    # model_id: (input_per_1m, output_per_1m)
    "llama-3.3-70b-versatile":            (0.59,  0.79),
    "llama-3.1-70b-versatile":            (0.59,  0.79),
    "llama-3.1-8b-instant":               (0.05,  0.08),
    "llama-3.2-1b-preview":               (0.04,  0.04),
    "llama-3.2-3b-preview":               (0.06,  0.06),
    "meta-llama/llama-4-scout-17b-16e-instruct": (0.11, 0.34),
    "qwen-qwq-32b":                       (0.29,  0.39),
    "gemma2-9b-it":                       (0.20,  0.20),
    "deepseek-r1-distill-llama-70b":      (0.75,  0.99),
    "whisper-large-v3-turbo":             (0.00,  0.00),  # audio pricing differs
}

_DEFAULT_PRICING = (0.20, 0.40)


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Return estimated USD cost for a call."""
    inp_rate, out_rate = _PRICING.get(model, _DEFAULT_PRICING)
    return (input_tokens * inp_rate + output_tokens * out_rate) / 1_000_000


def log_call(
    model: str,
    input_tokens: int,
    output_tokens: int,
    source: str = "chat",
    session_id: str = "",
) -> None:
    """Persist one LLM call to model_cost_log. Fire-and-forget; never raises."""
    try:
        cost = estimate_cost(model, input_tokens, output_tokens)
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO model_cost_log (model, input_tokens, output_tokens, cost_usd, source, session_id)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (model, input_tokens, output_tokens, cost, source, session_id))
        conn.commit()
        cur.close(); conn.close()
    except Exception as exc:
        log.warning("model_router: cost log failed (non-fatal)", error=str(exc))


# ── Complexity classifier ──────────────────────────────────────────────────────

_SIMPLE_RE = re.compile(
    r"^(what|who|where|when|how much|how many|is |are |does |did |can you |tell me)\b",
    re.I,
)
_COMPLEX_SIGNALS = (
    "analyze", "compare", "explain in detail", "write a", "draft",
    "research", "plan", "strategy", "implement", "build", "debug",
    "and then", "step by step", "summarize all", "find and",
)
_CHAIN_SIGNALS = (
    "and then send", "then apply", "if found", "after that", "and create",
    "and reply", "and forward", "then schedule",
)

_TIER = {
    "simple":  "llama-3.1-8b-instant",
    "medium":  "meta-llama/llama-4-scout-17b-16e-instruct",
    "complex": "llama-3.3-70b-versatile",
    "chain":   "llama-3.3-70b-versatile",
}


def classify(message: str) -> dict:
    """
    Classify message complexity and return recommended model + tier.
    Returns: {tier, model, reason}
    """
    lower = message.lower().strip()
    words = lower.split()

    if len(words) <= 5 or _SIMPLE_RE.match(lower):
        return {"tier": "simple", "model": _TIER["simple"], "reason": "Short or simple question"}

    if any(sig in lower for sig in _CHAIN_SIGNALS):
        return {"tier": "chain", "model": _TIER["chain"], "reason": "Multi-step chain detected"}

    if any(sig in lower for sig in _COMPLEX_SIGNALS) or len(words) > 40:
        return {"tier": "complex", "model": _TIER["complex"], "reason": "Complex / long request"}

    return {"tier": "medium", "model": _TIER["medium"], "reason": "Medium complexity"}
