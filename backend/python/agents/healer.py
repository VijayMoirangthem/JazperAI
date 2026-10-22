"""Self-healing for tool and connector failures (pattern: Project_References/hermes-agent agent/error_classifier.py + fallback recovery).

Before the model ever sees a raw error we CLASSIFY it (table below: kind + regex), run the matching remedy, and tell the caller whether to retry
the same call. Remedies fix what software can fix (restart a connector, switch on a Google API, refresh scopes, reset provider breakers, wait out a
rate limit, connect a missing service) and turn what only the founder can do into exactly ONE card (Google approval, credentials). Every case is
written to shared.capability_gaps so recurring problems are visible (`gaps` tool) and a new failure kind is one line in RULES.
"""
import asyncio
import re
import time
from dataclasses import dataclass, field

import structlog

log = structlog.get_logger()

# kind, regex (case-insensitive), what it means
RULES: list[tuple[str, str, str]] = [
    ("google_api_disabled", r"api is not enabled|accessnotconfigured|has not been used in project|service_disabled|api has not been used|is disabled", "the Google API is switched off for the Cloud project"),
    ("google_scope", r"insufficient (authentication )?scopes?|insufficientpermissions|has not granted this permission|access_denied.*scope|invalid_scope", "the Google token lacks a permission"),
    ("google_reauth", r"invalid_grant|token has been expired or revoked|no google account connected|unauthenticated|invalid credentials.*google|refresherror", "the Google sign-in expired or was revoked"),
    ("connector_down", r"is degraded|connection closed|broken pipe|connectionerror|connector .* (died|exited)|not connected|stdio|server (crashed|exited)", "the connector process is not running"),
    ("tool_unknown", r"unknown tool|no such tool|tool .* not found|invalid tool", "no connected tool by that name"),
    ("credentials", r"\b401\b|bad credentials|unauthorized|invalid (api )?key|missing .*(token|key|secret)|authentication (failed|required)|incorrect api key", "a key or token is missing or wrong"),
    ("provider_down", r"all providers failed|provider (error|is busy)|overloaded|\b50[234]\b|model .* unavailable", "the model provider is failing"),
    ("rate_limited", r"\b429\b|rate.?limit|quota ?exceeded|too many requests|resource_exhausted|usagelimit", "rate limited"),
    ("timeout", r"timed? ?out|timeout|deadline exceeded", "too slow"),
    ("not_found", r"\b404\b|not found|no such (file|folder)|does not exist", "the thing asked for does not exist"),
    ("denied", r"\b403\b|permission denied|forbidden|not authori[sz]ed to", "permission denied for this account"),
]
_COMPILED = [(k, re.compile(p, re.I), why) for k, p, why in RULES]
CAP_PREFIX = {"drive_": "drive", "docs_": "docs", "sheets_": "sheets", "gmail_": "gmail", "calendar_": "calendar"}


@dataclass
class Outcome:
    kind: str
    fixed: bool = False          # a remedy ran and verified
    retry: bool = False          # caller should repeat the original call now
    request: dict | None = None  # one card for the founder (only when software cannot fix it)
    message: str = ""            # one short, true sentence for the bot/founder
    steps: list[str] = field(default_factory=list)


def classify(text: str) -> tuple[str, str]:
    """(kind, why). First matching rule wins (table order = priority); 'unknown' when nothing matches."""
    for kind, rx, why in _COMPILED:
        if rx.search(text or ""):
            return kind, why
    return "unknown", "unclassified failure"


def is_failure(result: dict | str | None) -> bool:
    """True when a hub/MCP tool result is an error (flag, block, or an {"error": ...} body)."""
    if result is None:
        return True
    if isinstance(result, dict):
        if result.get("blocked") and "not approved" not in str(result.get("reason", "")):
            return True
        if result.get("is_error"):
            return True
        text = str(result.get("text", ""))
    else:
        text = str(result)
    return bool(re.search(r'^\s*\{\s*"error"\s*:', text)) or text.lower().startswith("error")


def _cap_of(tool: str) -> str | None:
    short = tool.split(".", 1)[-1]
    return next((c for p, c in CAP_PREFIX.items() if short.startswith(p)), None)


async def _ledger(kind: str, tool: str, error: str, outcome: str) -> None:
    try:
        from memory.db import aio
        await aio.execute("CREATE TABLE IF NOT EXISTS shared.capability_gaps (id bigserial PRIMARY KEY, ts timestamptz DEFAULT now(), kind text, tool text, error text, outcome text)")
        await aio.execute("INSERT INTO shared.capability_gaps (kind, tool, error, outcome) VALUES ($1,$2,$3,$4)", kind, tool, error[:400], outcome)
    except Exception as e:  # a ledger problem must never break healing
        log.warning("gap ledger failed", error=str(e)[:100])


async def recent_gaps(limit: int = 15) -> list[dict]:
    from memory.db import aio
    try:
        rows = await aio.fetch("SELECT kind, tool, outcome, count(*) AS n, max(ts) AS last FROM shared.capability_gaps WHERE ts > now() - interval '7 days' GROUP BY 1,2,3 ORDER BY n DESC LIMIT $1", limit)
        return [{"kind": r["kind"], "tool": r["tool"], "outcome": r["outcome"], "count": r["n"], "last": str(r["last"])[:16]} for r in rows]
    except Exception:
        return []


def _registered(cid: str) -> bool:
    from hub.hub import hub
    return cid in hub.manifests


async def _restart(cid: str) -> bool:
    from hub.hub import hub
    bad = hub.conns.pop(cid, None)
    if bad:
        await asyncio.to_thread(bad.stop)
    try:
        await asyncio.wait_for(hub.ensure(cid), 40)
        return True
    except Exception:
        return False


async def heal(tool: str, args: dict, error: str, agent: str = "jasper", attempt: int = 1) -> Outcome:
    """Diagnose one failed call and fix what can be fixed. `tool` is the full name ("google-workspace.drive_list_recent")."""
    from agents import connector
    kind, why = classify(error)
    cid = tool.split(".", 1)[0] if "." in tool else ""
    out = Outcome(kind=kind, message=f"{why}.")
    try:
        if kind in ("google_api_disabled", "google_scope", "google_reauth") or (cid == "google-workspace" and kind in ("denied", "credentials")):
            cap = _cap_of(tool) or "drive"
            st = await connector.ensure(cap)
            if st.get("request"):
                out.request, out.message = st["request"], st["request"].get("reason", "One approval needed.")
            elif st.get("verified"):
                out.fixed = out.retry = True
                out.message = f"fixed: Google {cap} verified again."
            else:
                out.message = str(st.get("detail", why))[:300]
        elif kind == "connector_down" and cid:
            ok = await _restart(cid)
            out.fixed = out.retry = ok
            out.message = f"restarted {cid}." if ok else f"{cid} would not start; check its credentials."
        elif kind == "rate_limited" and attempt == 1:
            await asyncio.sleep(4)
            out.retry, out.message = True, "waited out a rate limit."
        elif kind == "provider_down":
            from core.llm import registry as llm_reg
            for r in (await llm_reg.get_router()).routers.values():
                r.reset_breakers()
            out.retry, out.message = attempt == 1, "reset the model fallback chain."
        elif kind == "credentials" and cid:
            st = await connector.connect(cid)
            if st.get("request"):
                out.request, out.message = st["request"], "A key is missing or wrong: one secure card."
            elif st.get("connected"):
                out.fixed = out.retry = True
        elif kind == "tool_unknown" and cid in connector.catalogue() and not _registered(cid):
            # a known service that was simply never connected in this process: connect it (secrets/OAuth checked, one card if the founder is needed), then retry
            cap = _cap_of(tool)
            st = await (connector.ensure(cap) if cap else connector.connect(cid))
            if st.get("request"):
                out.request, out.message = st["request"], st["request"].get("reason", "One step needed to connect it.")
            elif st.get("verified") or st.get("connected"):
                out.fixed = out.retry = True
                out.message = f"connected {cid}."
            else:
                out.message = str(st.get("detail", why))[:300]
        elif kind == "tool_unknown":
            from hub.hub import hub
            hits = await hub.find_tool(tool.split(".", 1)[-1].replace("_", " "), 3)
            out.message = "No such tool. Closest: " + ", ".join(h["name"] for h in hits) if hits else "No such tool is connected; connect the service first."
        else:
            out.message = f"{why}: {error[:160]}"
    except Exception as e:
        out.message = f"healing itself failed ({str(e)[:100]}): {why}"
    out.steps.append(f"{kind} -> {'fixed' if out.fixed else 'founder step' if out.request else 'no auto-fix'}")
    await _ledger(kind, tool, error, "fixed" if out.fixed else "needs_founder" if out.request else "unfixed")
    return out
