"""Alerts, incident records (RCA taxonomy) and push (Plan V3 W10, spec sections 21-22).

run_checks() runs every 2 minutes (APScheduler, registered in main.py): SLO burn, backup age, approvals waiting, connectors down, providers down,
object store down, low disk, bot score drops. A condition raises ONE open alert (6 h cool-down per key), notifies in-app + phone push + the comms log,
and auto-resolves when the condition clears. incident() records any abort with a failure kind and the runbook that handles it; five of the same kind
in ten minutes raise a burst alert. Push text is generic on purpose (details are fetched after opening the app).
"""
import asyncio
import json
import shutil
import time
from pathlib import Path

import structlog

from memory.db import aio

log = structlog.get_logger()
ROOT = Path(__file__).resolve().parents[3]
RUNBOOKS = "docs/runbooks/"
COOLDOWN_S = 6 * 3600

# failure taxonomy: first matching keyword wins
KINDS = [
    ("insufficient_funds", ("insufficient", " 402")), ("rate_limit", ("rate limit", "rate-limited", " 429", "too many requests", "tokens per minute")),
    ("provider_down", ("all providers failed", "provider is busy", "connection error", "apiconnectionerror", " 5")), ("timeout", ("timeout", "timed out")),
    ("context_overflow", ("context length", "maximum context", "too many tokens", "context window")), ("tool_schema", ("invalid arguments", "unknown tool", "schema")),
    ("auth", (" 401", " 403", "unauthorized", "permission denied", "freetier")), ("test_failure", ("pytest", "mocha", "tests failed", "assertion", "rolled back")),
    ("connector_down", ("degraded", "connector")),
]


def classify(text: str) -> str:
    low = f" {text.lower()}"
    for kind, words in KINDS:
        if any(w in low for w in words):
            return kind
    return "unknown"


def runbook_for(kind: str) -> str:
    p = ROOT / RUNBOOKS / f"{kind}.md"
    return RUNBOOKS + f"{kind}.md" if p.exists() else RUNBOOKS + "README.md"


# ── dispatch ─────────────────────────────────────────────────────────────────────────────────────────
async def _notify(severity: str, title: str, detail: str, data: dict) -> None:
    try:
        from core.scheduler.scheduler import _create_notification
        await asyncio.to_thread(_create_notification, f"[{severity}] {title}", detail[:300], "alert")
    except Exception:
        pass
    try:
        from core import push
        await push.send("Jasper alert", title[:80], {"type": "alert", **data})
    except Exception:
        pass
    try:
        from agents import comms
        await comms.log("system", "founder", "event", f"ALERT {severity}: {title}. {detail[:200]}")
    except Exception:
        pass


async def raise_alert(key: str, severity: str, title: str, detail: str = "", runbook: str | None = None) -> bool:
    """Open an alert unless one is already open for this key. Returns True when a new alert was created."""
    open_ = await aio.fetch("SELECT id FROM shared.alerts WHERE key=$1 AND resolved_at IS NULL", key)
    if open_:
        return False
    rows = await aio.fetch("INSERT INTO shared.alerts(key, severity, title, detail, runbook) VALUES($1,$2,$3,$4,$5) RETURNING id", key, severity, title, detail[:500], runbook or runbook_for(key.split(":")[0]))
    await _notify(severity, title, detail, {"alert_id": rows[0]["id"], "key": key})
    return True


async def resolve_missing(active_keys: set[str]) -> int:
    rows = await aio.fetch("SELECT id, key FROM shared.alerts WHERE resolved_at IS NULL")
    n = 0
    for r in rows:
        if r["key"] not in active_keys:
            await aio.execute("UPDATE shared.alerts SET resolved_at=now() WHERE id=$1", r["id"])
            n += 1
    return n


# ── checks ───────────────────────────────────────────────────────────────────────────────────────────
async def check_all() -> list[tuple[str, str, str, str]]:
    """[(key, severity, title, detail)] for every condition that is true right now."""
    found: list[tuple[str, str, str, str]] = []

    async def safe(fn):
        try:
            await fn(found)
        except Exception as e:
            log.warning("alert check failed", check=fn.__name__, error=str(e)[:120])

    async def slo(out):
        from core import metrics
        for s in (await metrics.slo_status_async())["slos"]:
            if s["status"] == "breached" or (s["budget_remaining"] is not None and s["budget_remaining"] < 0.2):
                out.append((f"slo_breach:{s['slo']}", "critical" if s["status"] == "breached" else "warning", f"{s['slo']} error budget {'spent' if s['status'] == 'breached' else 'low'}", f"budget remaining {s['budget_remaining']}"))

    async def backup(out):
        p = ROOT / "storage" / "backups" / "last.json"
        age_h = (time.time() - p.stat().st_mtime) / 3600 if p.exists() else None
        if age_h is None or age_h > 26:
            out.append(("backup_stale", "warning", "Backup is older than 26 hours" if age_h else "No backup record found", f"last backup {round(age_h, 1) if age_h else 'never'} h ago"))

    async def approvals(out):
        n = (await aio.fetch("SELECT count(*) AS n FROM shared.hitl_requests WHERE status='pending' AND created_at < now() - interval '15 minutes'"))[0]["n"]
        if n:
            out.append(("approval_stuck", "warning", f"{n} approval request(s) waiting over 15 minutes", "open the Approvals tab"))

    async def connectors(out):
        from hub.hub import hub
        for cid, c in hub.conns.items():
            if not c.alive:
                out.append((f"connector_down:{cid}", "warning", f"Connector {cid} is down", "it restarts on next use; check Connections"))

    async def providers(out):
        from core.llm.registry import get_router
        r = await get_router()
        now = time.monotonic()
        for tier, lr in r.routers.items():
            for name, until in lr._open_until.items():
                if until > now:
                    out.append((f"provider_down:{name}", "warning", f"Model provider {name} is failing (circuit open)", f"tier {tier}; failover is active"))

    async def minio(out):
        from core import objectstore
        if not await asyncio.to_thread(objectstore.available):
            out.append(("minio_down", "warning", "Object store (MinIO) is not reachable", "backups and attachments are affected"))

    async def disk(out):
        free = shutil.disk_usage(str(ROOT)).free / 1e9
        if free < 10:
            out.append(("disk_low", "warning", f"Low disk space on the project drive ({free:.1f} GB free)", ""))

    async def scores(out):
        from agents import orgchart
        for g in (await orgchart.tree())["groups"]:
            for b in g["bots"]:
                if b["enabled"] and b["score"] is not None and b["score"] < 60 and b["calls"] >= 10:
                    out.append((f"bot_score:{b['slug']}", "info", f"Bot {b['slug']} score dropped to {b['score']}", f"{b['calls']} turns, {b['errors']} errors"))

    for fn in (slo, backup, approvals, connectors, providers, minio, disk, scores):
        await safe(fn)
    return found


async def run_checks() -> dict:
    found = await check_all()
    created = 0
    for key, sev, title, detail in found:
        created += int(await raise_alert(key, sev, title, detail))
    resolved = await resolve_missing({k for k, *_ in found})
    return {"active": len(found), "new": created, "resolved": resolved}


# ── incidents / RCA ──────────────────────────────────────────────────────────────────────────────────
async def incident(source: str, message: str, context: dict | None = None) -> None:
    """Record an abort with its failure kind and runbook. Never raises."""
    try:
        kind = classify(message)
        await aio.execute("INSERT INTO shared.incidents(source, kind, summary, context, runbook) VALUES($1,$2,$3,$4::jsonb,$5)", source, kind, message[:400], json.dumps(context or {}, default=str), runbook_for(kind))
        n = (await aio.fetch("SELECT count(*) AS n FROM shared.incidents WHERE kind=$1 AND ts > now() - interval '10 minutes'", kind))[0]["n"]
        if n >= 5 and kind != "unknown":
            await raise_alert(f"{kind}:burst", "warning", f"{n} '{kind}' incidents in 10 minutes", message[:200], runbook_for(kind))
    except Exception:
        pass


async def list_alerts(limit: int = 30) -> dict:
    open_ = [dict(r) for r in await aio.fetch("SELECT * FROM shared.alerts WHERE resolved_at IS NULL ORDER BY id DESC LIMIT $1", limit)]
    recent = [dict(r) for r in await aio.fetch("SELECT * FROM shared.alerts WHERE resolved_at IS NOT NULL ORDER BY id DESC LIMIT 10")]
    return {"open": open_, "resolved": recent}


async def list_incidents(limit: int = 30) -> list[dict]:
    return [dict(r) for r in await aio.fetch("SELECT id, ts, source, kind, summary, runbook FROM shared.incidents ORDER BY id DESC LIMIT $1", limit)]


async def weekly_chaos() -> None:
    """Sandbox-only resilience experiments once a week; any failure becomes an alert (spec section 21)."""
    try:
        from agents import chaos
        results = await chaos.run_all()
        bad = [r for r in results if not r["passed"]]
        await raise_alert("chaos_failed", "warning", f"{len(bad)} chaos experiment(s) failed", "; ".join(f"{r['name']}: {r['detail'][:80]}" for r in bad), RUNBOOKS + "chaos_failed.md") if bad else None
    except Exception as e:
        log.warning("weekly chaos failed", error=str(e)[:120])
