"""Self-improving skill library (pattern: Project_References/hermes-agent agent/background_review.py + tools/skill_manager_tool.py).

A skill is a reusable procedure for a CLASS of task (name, one-line description, step-by-step body). Only name + description are put in
a bot's prompt; the body is loaded on demand with view_skill (progressive disclosure keeps tokens low). After a turn that used tools
or delegated work, `review_turn` asks a light model whether anything is worth saving: patch an existing skill first, create a new one only
when nothing fits, otherwise do nothing. Every change is versioned in shared.skill_history. Outcomes (wins/losses) come from thumbs.
"""
import json
import re

import structlog

from core.llm.types import LLMRequest
from memory.db import aio

log = structlog.get_logger()
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,60}$")
BODY_MAX = 6000

REVIEW_SYSTEM = (
    "You maintain a library of reusable SKILLS (procedures for a class of task) for an AI team. Review the exchange and decide if a skill should "
    "be created or improved. Rules: prefer PATCHING an existing skill that covers the territory; create a new class-level skill only if none fits; "
    "a skill is a short numbered procedure (steps in order, exact tools/commands that worked, the founder's preferences, pitfalls) - not a story of "
    "what happened, no secrets, no one-off details. If the exchange had no reusable lesson, do nothing. Reply with JSON only: "
    '{"op":"none"} or {"op":"create","name":"kebab-name","description":"one line: when to use","body":"1. ...","why":"..."} or '
    '{"op":"patch","name":"existing-name","body":"full improved body","why":"..."}.')


async def catalogue(limit: int = 12) -> str:
    """Compact skill index for prompts (name: description), most used first."""
    try:
        rows = await aio.fetch("SELECT name, description FROM shared.skills WHERE enabled ORDER BY uses DESC, updated_at DESC LIMIT $1", limit)
    except Exception:
        return ""
    return "\n".join(f"- {r['name']}: {r['description'][:110]}" for r in rows)


async def list_skills() -> list[dict]:
    return [dict(r) for r in await aio.fetch(
        "SELECT name, description, owner, version, uses, wins, losses, created_by, enabled, updated_at, last_used_at FROM shared.skills ORDER BY uses DESC, name")]


async def view(name: str, count_use: bool = True) -> dict | None:
    rows = await aio.fetch("SELECT * FROM shared.skills WHERE name=$1 AND enabled", name)
    if not rows:
        return None
    if count_use:
        await aio.execute("UPDATE shared.skills SET uses=uses+1, last_used_at=now() WHERE name=$1", name)
    return dict(rows[0])


async def save(name: str, description: str, body: str, by: str, reason: str = "", create_only: bool = False) -> dict:
    name = name.strip().lower()
    if not NAME_RE.match(name):
        return {"ok": False, "error": "name must be kebab-case (a-z, 0-9, -)"}
    if not description.strip() or not body.strip():
        return {"ok": False, "error": "description and body are required"}
    body = body.strip()[:BODY_MAX]
    cur = await aio.fetch("SELECT version FROM shared.skills WHERE name=$1", name)
    if cur and create_only:
        return {"ok": False, "error": f"skill {name} exists; patch it instead"}
    if cur:
        v = cur[0]["version"] + 1
        await aio.execute("UPDATE shared.skills SET description=$2, body=$3, version=$4, updated_at=now() WHERE name=$1", name, description.strip()[:200], body, v)
    else:
        v = 1
        await aio.execute("INSERT INTO shared.skills(name, description, body, created_by) VALUES($1,$2,$3,$4)", name, description.strip()[:200], body, by)
    await aio.execute("INSERT INTO shared.skill_history(name, version, body, changed_by, reason) VALUES($1,$2,$3,$4,$5)", name, v, body, by, reason[:300])
    return {"ok": True, "name": name, "version": v, "action": "patched" if cur else "created"}


async def set_enabled(name: str, enabled: bool) -> bool:
    return bool(await aio.execute("UPDATE shared.skills SET enabled=$2 WHERE name=$1", name, enabled))


async def outcome(name: str, win: bool) -> None:
    col = "wins" if win else "losses"
    await aio.execute(f"UPDATE shared.skills SET {col}={col}+1 WHERE name=$1", name)


def _json(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text, re.S)
    try:
        return json.loads(m.group(0)) if m else None
    except Exception:
        return None


async def review_turn(router, slug: str, user_text: str, trace: str, answer: str) -> dict:
    """Background Hermes-style review. `trace` is a compact list of the tool calls/delegations of the turn. Never raises."""
    try:
        existing = await catalogue(30)
        prompt = (f"Existing skills:\n{existing or '(none)'}\n\nBot: {slug}\nUser asked: {user_text[:800]}\nSteps taken: {trace[:1200]}\nFinal answer: {answer[:800]}")
        res = await router.complete(LLMRequest(system=REVIEW_SYSTEM, messages=[{"role": "user", "content": prompt}], tier="light", max_tokens=700, temperature=0.2))
        d = _json(res.text) or {"op": "none"}
        if d.get("op") == "create":
            return {"op": "create", **await save(str(d.get("name", "")), str(d.get("description", "")), str(d.get("body", "")), slug, str(d.get("why", "")), create_only=True)}
        if d.get("op") == "patch":
            cur = await aio.fetch("SELECT description FROM shared.skills WHERE name=$1", str(d.get("name", "")))
            if cur:
                return {"op": "patch", **await save(str(d["name"]), cur[0]["description"], str(d.get("body", "")), slug, str(d.get("why", "")))}
        return {"op": "none"}
    except Exception as e:
        log.warning("skill review failed", error=str(e)[:160])
        return {"op": "error"}


async def history(name: str, limit: int = 20) -> list[dict]:
    return [dict(r) for r in await aio.fetch("SELECT version, changed_by, reason, ts FROM shared.skill_history WHERE name=$1 ORDER BY id DESC LIMIT $2", name, limit)]
