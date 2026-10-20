"""Organisation overlay for bots: groups (Jazper Team, companies), departments, position, order, prompt overrides, stats and score.

Works for every bot regardless of source (built-in persona, spec stub, dynamic) because it is keyed by slug in shared.bot_org.
Seeding is idempotent and never overwrites a placement the founder changed.
"""
from datetime import datetime, timezone

from agents.registry import BotDef, registry
from memory.db import aio

# id -> (label, kind, sort_order)
GROUPS: dict[str, tuple[str, str, int]] = {
    "chief": ("Jasper — Chief Orchestrator", "chief", 0),
    "jazper_team": ("Jazper Team", "team", 10),
    "create_origins": ("Create Origins", "company", 20),
    "baeit": ("Baeit", "company", 30),
    "boardmint": ("Boardmint", "company", 40),
    "legacy": ("Legacy personas", "legacy", 90),
}

# crew -> (group, department)
CREW_HOME = {
    "coreops": ("create_origins", "Core Operations"), "people": ("create_origins", "People"), "it": ("create_origins", "IT & Core Systems"),
    "rnd": ("create_origins", "R&D"), "sre": ("create_origins", "SRE"), "baeit": ("baeit", "Engineering & Operations"),
    "boardmint": ("boardmint", "Compliance & Governance"), "personal": ("jazper_team", "Personal"),
}
SLUG_HOME = {
    "jasper": ("chief", ""), "ceo-baeit": ("baeit", "Executive"), "lead-boardmint": ("boardmint", "Executive"),
    "ceo-create-origins": ("create_origins", "Executive"), "vp-tech-ops": ("create_origins", "Executive"), "cfo": ("create_origins", "Executive"),
    "coo": ("create_origins", "Executive"), "general-counsel": ("create_origins", "Executive"),
    "scout": ("jazper_team", "Personal"), "atlas": ("jazper_team", "Personal"),
    "chaosbot": ("create_origins", "SRE"), "messenger": ("jazper_team", "Personal"), "bot-creator": ("jazper_team", "Bot Operations"), "connector": ("jazper_team", "Integrations"), "bot-reviewer": ("jazper_team", "Bot Operations"),
}

JAZPER_TEAM_BOTS = [
    BotDef(slug="messenger", display_name="Messenger", role_title="Email triage: tells the founder what matters", crew="personal",
           prompt=("You are Messenger on the Jazper Team, the founder's mail watcher. For anything about email: FIRST check whether Gmail is connected (find_tool 'gmail', or list_connections). If it is not, ask `connector` to connect it and relay exactly what it needs from the founder. Once connected, search the inbox with the Gmail tools (read-only) and answer the question directly: what you found, which messages matter (urgent, needs a reply, money/legal, people waiting), sender, one-line reason, suggested action. If nothing matches say so plainly. Never send, delete or archive mail yourself; propose drafts for approval."),
           model_policy={"default_tier": "standard"}),
    BotDef(slug="connector", display_name="Connector", role_title="Connects Jasper to Gmail, calendar, GitHub and other tools; verifies they work", crew="personal",
           prompt=("You are Connector on the Jazper Team. You own every integration. When asked to connect a service: call connect; it checks the vault and backend .env itself and tells you if "
                   "anything is missing. If credentials or a Google sign-in are needed the founder is shown a secure card automatically: say exactly what is needed and why, never ask for secrets in chat. "
                   "After connecting, run test_connection and report one line: connected / needs X / failed because Y. For health checks use list_connections. Be brief and factual; never claim success without a passing test."),
           model_policy={"default_tier": "standard"}),
    BotDef(slug="bot-creator", display_name="Bot Creator", role_title="Designs and creates new bots on request", crew="personal",
           prompt=("You are Bot Creator on the Jazper Team. Given a need, you design a new bot: a slug (lowercase-hyphen), display name, role title, group/department, "
                   "a tight system prompt (role, duties, boundaries, output style, escalation to Jasper), tier (light/standard/frontier) and tools. Reply with the full definition as JSON "
                   "so Jasper can create it after the founder approves. Prefer reusing an existing bot over creating a duplicate; say so if one already fits."),
           model_policy={"default_tier": "standard"}),
    BotDef(slug="bot-reviewer", display_name="Bot Reviewer", role_title="Scores every bot and proposes improvements", crew="personal",
           prompt=("You are Bot Reviewer on the Jazper Team. You receive per-bot stats (calls, errors, thumbs up/down, latency, score). Produce: a ranked list of bots needing attention, "
                   "the likely cause for each (prompt too vague, wrong tier, tool errors, too slow), and one concrete improvement per bot (e.g. a prompt edit). "
                   "Flag bots with no activity as candidates to retire. Be specific and short."),
           model_policy={"default_tier": "standard"}),
]

SRE_BOTS = [
    BotDef(slug="chaosbot", display_name="ChaosBot", role_title="Sandbox-only fault injection and resilience checks", crew="sre", reports_to="vp-tech-ops",
           prompt=("You are ChaosBot (SRE). You run fault-injection experiments only against disposable targets (fake providers, the Docker sandbox, a private demo connector) - never production. "
                   "For each experiment state the hypothesis, the injected fault, the result and, on failure, a concrete fix. Report via the run_chaos results; do not speculate beyond them."),
           model_policy={"default_tier": "standard"}),
]

OVERRIDES: dict[str, str] = {}  # slug -> prompt override, read synchronously by the chat path


def home_for(slug: str, crew: str, source: str) -> tuple[str, str]:
    if slug in SLUG_HOME:
        return SLUG_HOME[slug]
    if source in ("builtin", "spec"):
        return ("legacy", "Built-in personas" if source == "builtin" else "Specs (inactive)")
    return CREW_HOME.get(crew, ("legacy", "Unassigned"))


async def ensure_orgchart() -> int:
    """Create groups + Jazper Team bots + placement rows for any bot not yet placed. Returns rows added."""
    for gid, (label, kind, order) in GROUPS.items():
        await aio.execute("INSERT INTO shared.org_groups(id,label,sort_order,kind) VALUES($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING", gid, label, order, kind)
    have_bots = {r["slug"] for r in await aio.fetch("SELECT slug FROM shared.bot_definitions")}
    for b in JAZPER_TEAM_BOTS + SRE_BOTS:
        if b.slug not in have_bots:
            b.lifecycle = "active"
            await registry.upsert(b)
    placed = {r["slug"] for r in await aio.fetch("SELECT slug FROM shared.bot_org")}
    added = 0
    for i, r in enumerate(registry.roster()):
        if r["slug"] in placed:
            continue
        group, dept = home_for(r["slug"], r["crew"], r.get("source", "dynamic"))
        await aio.execute("INSERT INTO shared.bot_org(slug, org_group, department, position, sort_order, started_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
                          r["slug"], group, dept, r.get("role_title", ""), 100 + i,
                          None if r.get("lifecycle") == "spec" else datetime.now(timezone.utc))
        added += 1
    await load_overrides()
    from agents import workspaces
    await workspaces.ensure_seeds()
    return added


async def load_overrides() -> None:
    from agents import workspaces
    workspaces.GROUP_OF.clear()
    workspaces.GROUP_OF.update({r["slug"]: r["org_group"] for r in await aio.fetch("SELECT slug, org_group FROM shared.bot_org")})
    OVERRIDES.clear()
    for r in await aio.fetch("SELECT slug, prompt_override FROM shared.bot_org WHERE prompt_override IS NOT NULL AND prompt_override <> ''"):
        OVERRIDES[r["slug"]] = r["prompt_override"]


async def record_call(slug: str, ok: bool, latency_ms: int = 0) -> None:
    """Called after each bot turn; stats feed the score. Never raises."""
    try:
        await aio.execute(
            """INSERT INTO shared.bot_stats(slug, calls, errors, latency_ms_total, first_active_at, last_active_at)
               VALUES($1,1,$2,$3,now(),now())
               ON CONFLICT (slug) DO UPDATE SET calls=shared.bot_stats.calls+1, errors=shared.bot_stats.errors+$2,
                 latency_ms_total=shared.bot_stats.latency_ms_total+$3, last_active_at=now(),
                 first_active_at=COALESCE(shared.bot_stats.first_active_at, now())""", slug, 0 if ok else 1, latency_ms)
    except Exception:
        pass


async def rate(slug: str, up: bool) -> None:
    col = "thumbs_up" if up else "thumbs_down"
    await aio.execute(f"INSERT INTO shared.bot_stats(slug, {col}) VALUES($1,1) ON CONFLICT (slug) DO UPDATE SET {col}=shared.bot_stats.{col}+1", slug)


def score_of(s: dict | None) -> dict:
    """0-100: 60% reliability (non-error turns) + 40% satisfaction (Laplace-smoothed thumbs). None until 3 turns."""
    s = s or {}
    calls, errors, up, down = s.get("calls", 0) or 0, s.get("errors", 0) or 0, s.get("thumbs_up", 0) or 0, s.get("thumbs_down", 0) or 0
    avg = round((s.get("latency_ms_total", 0) or 0) / calls) if calls else 0
    base = {"calls": calls, "errors": errors, "thumbs_up": up, "thumbs_down": down, "avg_latency_ms": avg,
            "first_active_at": s.get("first_active_at"), "last_active_at": s.get("last_active_at")}
    if calls < 3:
        return {**base, "score": None, "grade": "new"}
    score = round(100 * (0.6 * (1 - errors / calls) + 0.4 * ((up + 1) / (up + down + 2))))
    return {**base, "score": score, "grade": "good" if score >= 80 else "ok" if score >= 60 else "needs-attention"}


async def tree() -> dict:
    """Groups with their bots (roster + overlay + score), ordered. Disabled/spec bots included (flagged)."""
    await registry.reload()
    org = {r["slug"]: dict(r) for r in await aio.fetch("SELECT * FROM shared.bot_org")}
    stats = {r["slug"]: dict(r) for r in await aio.fetch("SELECT * FROM shared.bot_stats")}
    created = {r["slug"]: r["created_at"] for r in await aio.fetch("SELECT slug, created_at FROM shared.bot_definitions")}
    groups = [dict(r) | {"bots": []} for r in await aio.fetch("SELECT * FROM shared.org_groups ORDER BY sort_order, id")]
    by_id = {g["id"]: g for g in groups}
    for r in registry.roster():
        o = org.get(r["slug"], {})
        g = by_id.get(o.get("org_group", "legacy")) or by_id["legacy"]
        st = score_of(stats.get(r["slug"]))
        g["bots"].append({
            "slug": r["slug"], "display_name": r["display_name"], "role_title": r["role_title"], "crew": r["crew"], "reports_to": r.get("reports_to"),
            "enabled": r.get("enabled", True), "source": r.get("source", "dynamic"), "lifecycle": r.get("lifecycle"),
            "department": o.get("department", ""), "position": o.get("position") or r["role_title"], "sort_order": o.get("sort_order", 1000),
            "created_at": (created.get(r["slug"]) or o.get("created_at")), "started_at": o.get("started_at"), "has_prompt_override": bool(o.get("prompt_override")),
            "tier": (r.get("model_policy") or {}).get("default_tier", "standard"), "tools": r.get("tools", []), **st,
        })
    for g in groups:
        g["bots"].sort(key=lambda b: (b["sort_order"], b["slug"]))
    return {"groups": groups}


async def card(slug: str) -> dict | None:
    for g in (await tree())["groups"]:
        for b in g["bots"]:
            if b["slug"] == slug:
                d = registry.get(slug)
                prompt = OVERRIDES.get(slug) or (d.prompt if d else "")
                return {**b, "group": g["id"], "group_label": g["label"], "prompt": prompt, "prompt_is_default": not d and slug not in OVERRIDES,
                        "memory_namespace": d.memory_namespace if d else f"bot.{slug}"}
    return None


async def place(slug: str, org_group: str | None = None, department: str | None = None, position: str | None = None, sort_order: int | None = None) -> None:
    await aio.execute("INSERT INTO shared.bot_org(slug) VALUES($1) ON CONFLICT DO NOTHING", slug)
    if org_group:
        from agents import workspaces
        workspaces.GROUP_OF[slug] = org_group
    for col, val in (("org_group", org_group), ("department", department), ("position", position), ("sort_order", sort_order)):
        if val is not None:
            await aio.execute(f"UPDATE shared.bot_org SET {col}=$2, updated_at=now() WHERE slug=$1", slug, val)


async def set_prompt(slug: str, prompt: str | None) -> None:
    await aio.execute("INSERT INTO shared.bot_org(slug) VALUES($1) ON CONFLICT DO NOTHING", slug)
    await aio.execute("UPDATE shared.bot_org SET prompt_override=$2, updated_at=now() WHERE slug=$1", slug, prompt or None)
    await load_overrides()
