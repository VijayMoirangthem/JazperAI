"""System access for bots: a small tool loop around the LLM stream (Jasper streams it, other bots run it headless via run_bot).

The router has no native tool calling, so a bot emits ONE call per turn as  <tool>{"name":..,"args":{..}}</tool>. We run it (state-changing tools are
gated by core.hitl), feed the result back and let the bot continue (max MAX_ROUNDS). Each bot only sees the tools in TOOLS_FOR (least privilege);
bots without an entry answer as plain personas. Every delegation, reply and tool call is written to shared.bot_messages (agents/comms.py) so the
founder can watch it. Things the founder must act on (credentials card, Google sign-in) travel on a side channel and come out as {"ui": ...} events.
After a turn that used tools, a background review may save or patch a skill (agents/skills.py, Hermes pattern).
"""
import asyncio
import contextvars
import json
import re
import time
from collections.abc import AsyncIterator

from agents import comms, connector, orgchart, skills
from agents.registry import BotDef, registry
from core import finops, hitl
from core.llm.types import LLMRequest, Usage
from hub.hub import ToolError, hub

MAX_ROUNDS = 4
MAX_DEPTH = 2
CALL_RE = re.compile(r"<tool>\s*(\{.*?\})\s*</tool>", re.S)
_ui: contextvars.ContextVar[list | None] = contextvars.ContextVar("ui_events", default=None)
_depth: contextvars.ContextVar[int] = contextvars.ContextVar("bot_depth", default=0)

HELP = {
    "list_org": "list_org {} : groups, departments, bots with role and score",
    "ask_bot": "ask_bot {slug,text} : delegate to a bot and get its answer (use the right specialist; for any service connection ask `connector`)",
    "bot_stats": "bot_stats {} : per-bot calls, errors, thumbs, latency, score",
    "create_bot": "create_bot {slug,display_name,role_title,prompt,group,department,tier} : create a bot (needs approval)",
    "edit_bot_prompt": "edit_bot_prompt {slug,prompt} : change a bot's system prompt (needs approval)",
    "run_chaos": "run_chaos {experiment} : sandbox-only resilience test (provider_failover, provider_total_outage, sandbox_memory_bomb, sandbox_fork_bomb, connector_crash_recovery, all)",
    "slo": "slo {} : availability/latency SLOs and error budget",
    "find_tool": "find_tool {query} : search connected MCP tools (empty result = the service is probably not connected)",
    "use_tool": "use_tool {name,arguments} : run an MCP tool by full name (writes need approval)",
    "list_connections": "list_connections {} : every connector with status (connected / missing secrets / needs sign-in)",
    "connect": "connect {connector} : connect a service (gmail, calendar, github, slack, notion, filesystem, memory). Uses secrets found in the vault or .env; otherwise shows the founder a secure card",
    "test_connection": "test_connection {connector} : run the harmless read check on a connector",
    "hold_meeting": "hold_meeting {group,topic} : the bots of a group (create_origins, baeit, boardmint, jazper_team) discuss a topic and their lead concludes; returns the conclusion",
    "list_skills": "list_skills {} : the shared skill library (name: when to use)",
    "view_skill": "view_skill {name} : load a skill's step-by-step procedure before doing that kind of task",
    "save_skill": "save_skill {name,description,body} : create or improve a reusable skill (numbered steps, no secrets)",
}
TOOLS_FOR: dict[str, list[str]] = {
    "jasper": ["list_org", "ask_bot", "bot_stats", "create_bot", "edit_bot_prompt", "run_chaos", "slo", "find_tool", "use_tool", "list_connections", "hold_meeting", "list_skills", "view_skill", "save_skill"],
    "connector": ["list_connections", "connect", "test_connection", "find_tool", "list_skills", "view_skill", "save_skill"],
    "herald": ["find_tool", "use_tool", "list_connections", "ask_bot", "list_skills", "view_skill"],
    "bot-reviewer": ["list_org", "bot_stats", "list_skills", "view_skill"],
    "bot-creator": ["list_org", "list_skills"],
    "chaosbot": ["slo", "run_chaos"],
}
INTRO = 'You have system access. To use a tool reply with ONLY one line: <tool>{"name":"NAME","args":{...}}</tool> and wait for the result, then continue. Tools:\n'
RULES = ("\nRouting: anything about email goes to `herald` (it checks Gmail and asks `connector` itself); connections go to `connector`. One tool call at a time. Delegate to the right specialist instead of doing everything yourself. If a service is not connected, ask `connector` to connect it "
         "(it checks the vault/.env and asks the founder only if something is missing). Never ask the founder to paste secrets into chat: a secure card is shown for that. "
         "Answer the founder concisely when done.")


def has_tools(slug: str) -> bool:
    return slug in TOOLS_FOR


async def system_for(slug: str, system: str) -> str:
    lines = "\n".join("- " + HELP[t] for t in TOOLS_FOR[slug])
    cat = await skills.catalogue()
    return f"{system}\n\n{INTRO}{lines}{RULES}" + (f"\n\nSkills you can load with view_skill:\n{cat}" if cat else "")


def _clip(x, n: int = 1800) -> str:
    s = x if isinstance(x, str) else json.dumps(x, default=str)
    return s if len(s) <= n else s[:n] + "…"


def _bot_line(b: dict) -> str:
    extra = "" if b["enabled"] else ", inactive"
    if b["score"] is not None:
        extra += f", score {b['score']}"
    return f"{b['slug']}({b['position'][:40]}{extra})"


def _push_ui(req: dict) -> None:
    bucket = _ui.get()
    if bucket is not None:
        bucket.append(req)


def _conn_line(c: dict) -> dict:
    return {"id": c["id"], "connected": c.get("connected", False), "ready": c.get("ready", False), "missing": c.get("missing", []),
            "needs_google_signin": bool(c.get("oauth") and not c["oauth"]["connected"]), "detail": c.get("detail", ""), "untested": c.get("untested", False)}


async def run_tool(name: str, args: dict, agent: str) -> str:
    if name not in TOOLS_FOR.get(agent, []):
        return f"error: tool {name} is not available to {agent}"
    if name == "list_org":
        return _clip("\n".join(f"{g['label']}: " + "; ".join(_bot_line(b) for b in g["bots"]) for g in (await orgchart.tree())["groups"]), 3500)
    if name == "bot_stats":
        return _clip([{k: b[k] for k in ("slug", "calls", "errors", "thumbs_up", "thumbs_down", "avg_latency_ms", "score")}
                      for g in (await orgchart.tree())["groups"] for b in g["bots"] if b["enabled"]], 3500)
    if name == "ask_bot":
        slug, text = str(args.get("slug", "")), str(args.get("text", ""))[:4000]
        if slug in (agent, "") or not any(r["slug"] == slug and r.get("enabled") for r in registry.roster()):
            return f"error: bot {slug or '?'} not found, disabled or is yourself"
        await comms.log(agent, slug, "ask", text)
        t0 = time.monotonic()
        try:
            reply = await run_bot(slug, text, asker=agent)
            await orgchart.record_call(slug, True, int((time.monotonic() - t0) * 1000))
        except Exception as e:
            await orgchart.record_call(slug, False, int((time.monotonic() - t0) * 1000))
            await comms.log(slug, agent, "reply", "error: " + str(e)[:200])
            return f"error: {str(e)[:200]}"
        await comms.log(slug, agent, "reply", reply)
        return _clip(reply)
    if name == "create_bot":
        slug = str(args.get("slug", "")).strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,62}", slug):
            return "error: slug must be lowercase letters, digits, - . _"
        if registry.get(slug):
            return f"error: bot {slug} already exists"
        if not await hitl.gate("bot.create", f"Create bot {slug}: {str(args.get('role_title', ''))[:120]}", agent):
            return "blocked: founder did not approve"
        b = BotDef(slug=slug, display_name=str(args.get("display_name") or slug), role_title=str(args.get("role_title", "")), crew=str(args.get("group", "personal")),
                   prompt=str(args.get("prompt", "")), model_policy={"default_tier": args.get("tier", "standard")}, lifecycle="probation")
        await registry.upsert(b)
        await orgchart.place(slug, str(args.get("group", "jazper_team")), str(args.get("department", "")), b.role_title)
        return f"created {slug} (probation) in {args.get('group', 'jazper_team')}"
    if name == "edit_bot_prompt":
        slug = str(args.get("slug", ""))
        if not any(r["slug"] == slug for r in registry.roster()):
            return f"error: unknown bot {slug}"
        if not await hitl.gate("bot.edit", f"Change system prompt of {slug}", agent):
            return "blocked: founder did not approve"
        await orgchart.set_prompt(slug, str(args.get("prompt", "")))
        return f"prompt of {slug} updated"
    if name == "slo":
        from core import metrics
        return _clip(await metrics.slo_status_async())
    if name == "run_chaos":
        from agents import chaos
        exp = str(args.get("experiment", ""))
        if exp != "all" and exp not in chaos.EXPERIMENTS:
            return f"error: unknown experiment; choose from {list(chaos.EXPERIMENTS)} or all"
        if not await hitl.gate("chaos.run", f"Run chaos experiment {exp} (sandbox only)", agent):
            return "blocked: founder did not approve"
        res = await chaos.run_all() if exp == "all" else [await chaos.run(exp)]
        return _clip([{k: r[k] for k in ("name", "passed", "detail", "ms")} for r in res])
    if name == "find_tool":
        found = await hub.find_tool(str(args.get("query", "")), k=5)
        if not found:
            return "no connected tool matches; the service is probably not connected (ask connector to connect it)"
        return _clip([{"name": t["name"], "tier": t["tier"], "description": t["description"][:100], "args": list(t["schema"].get("properties", {}))} for t in found])
    if name == "use_tool":
        try:
            return _clip(await hub.use_tool(str(args.get("name", "")), args.get("arguments") or {}, agent=agent))
        except ToolError as e:
            return f"error: {str(e)[:300]}"
    if name == "list_connections":
        return _clip([_conn_line(c) for c in await connector.overview()], 3000)
    if name in ("connect", "test_connection"):
        cid = connector.resolve(str(args.get("connector", "")))
        if not cid:
            return f"error: unknown connector; choose from {list(connector.catalogue())}"
        st = await (connector.connect(cid) if name == "connect" else connector.test(cid))
        req = st.get("request")
        if req:
            _push_ui(req)
            what = "a secure credentials card" if req["kind"] == "credentials" else "a Google sign-in button"
            return (f"{cid} is not connected yet. The founder has been shown {what} in chat. Tell them what is needed and that you will "
                    "finish connecting once they have done it. Do not ask them to type secrets in chat.")
        return _clip(_conn_line(st))
    if name == "hold_meeting":
        from agents import discussion
        from core.llm.registry import get_router
        group, topic = str(args.get("group", "")), str(args.get("topic", ""))[:600]
        if not topic or not await discussion.members_of(group):
            return "error: give a topic and a group with active bots (create_origins, baeit, boardmint, jazper_team)"
        router, lead, concl, said = await get_router(), discussion.LEADS.get(group, "jasper"), "", {}
        async for ev in discussion.stream(router, group, topic, 1):
            if ev.get("t") == "delta":
                said[ev["slug"]] = said.get(ev["slug"], "") + ev["text"]
        return _clip(f"Meeting in {group} on '{topic}'. Conclusion by {lead}: {said.get(lead, '(none)')}  |  Views: " + " / ".join(f"{k}: {v[:140]}" for k, v in said.items() if k != lead), 2600)
    if name == "list_skills":
        return _clip(await skills.catalogue(40) or "(no skills yet)", 3000)
    if name == "view_skill":
        s = await skills.view(str(args.get("name", "")))
        return _clip(f"{s['name']} v{s['version']}\n{s['body']}", 3500) if s else "error: no such skill"
    if name == "save_skill":
        return json.dumps(await skills.save(str(args.get("name", "")), str(args.get("description", "")), str(args.get("body", "")), agent))
    return f"error: unknown tool {name}"


async def _rounds(r, slug: str, system: str, msgs: list[dict], tier: str, trace: list[str]) -> AsyncIterator[dict]:
    """Core loop shared by streaming (Jasper) and headless (run_bot) use."""
    system = await system_for(slug, system)
    msgs = list(msgs)
    for rnd in range(MAX_ROUNDS + 1):
        buf, emitted, mode, last_usage = "", 0, "text", None
        async for item in r.stream(LLMRequest(system=system, messages=msgs, tier=tier, max_tokens=1024 if rnd < MAX_ROUNDS else 700)):
            if isinstance(item, Usage):
                last_usage = item
                continue
            buf += item
            if mode == "text":
                i = buf.find("<tool")
                if i >= 0:  # a call may follow prose: stop streaming at it and buffer the rest
                    mode, safe = "tool", i
                else:
                    safe = len(buf) - 5  # hold back a tail that could be the start of "<tool"
                if safe > emitted:
                    yield {"delta": buf[emitted:safe]}
                    emitted = safe
        call = CALL_RE.search(buf) if mode == "tool" else None
        if mode == "text" and len(buf) > emitted:
            yield {"delta": buf[emitted:]}
        if not call or rnd == MAX_ROUNDS:
            if mode == "tool":
                rest = CALL_RE.sub("", buf[emitted:]).replace("<tool>", "").strip()
                yield {"delta": rest or ("" if emitted else "(I could not complete that action.)")}
            if last_usage:
                yield {"usage": last_usage}
            return
        try:
            spec = json.loads(call.group(1))
            name, args = str(spec.get("name", "")), spec.get("args") or {}
        except Exception:
            name, args = "?", {}
        args = args if isinstance(args, dict) else {}
        label = f"{name} {args.get('slug') or args.get('connector') or args.get('name') or ''}".strip()
        yield {"tool": {"name": name, "label": label, "status": "running"}}
        await comms.log(slug, f"tool:{name}", "tool", json.dumps(args, default=str)[:600])
        try:
            result = await run_tool(name, args, slug)
        except Exception as e:
            result = f"error: {str(e)[:200]}"
        await comms.log(slug, f"tool:{name}", "result", result[:600])
        trace.append(f"{name}({json.dumps(args, default=str)[:80]}) -> {result[:80]}")
        yield {"tool": {"name": name, "label": label, "status": "error" if result.startswith(("error", "blocked")) else "ok", "result": result[:300]}}
        pending = _ui.get()
        if pending and _depth.get() == 0:  # only the top-level bot surfaces UI requests; nested bots leave them queued
            for req in list(pending):
                yield {"ui": req}
            pending.clear()
        msgs += [{"role": "assistant", "content": buf.strip()}, {"role": "user", "content": f"<tool_result name=\"{name}\">{result}</tool_result>"}]


def _spawn_review(r, slug: str, user_text: str, trace: list[str], answer: str) -> None:
    """After a tool-using turn: maybe save/patch a skill, and store the bot's own lessons in its separate memory namespace."""
    if trace and answer:
        from memory import consolidate
        asyncio.create_task(skills.review_turn(r, slug, user_text, " | ".join(trace), answer))
        asyncio.create_task(consolidate.consolidate_turn(r, user_text, answer + " Steps: " + " | ".join(trace)[:600], ns=f"bot.{slug}", bot=True))


async def stream_with_tools(r, system: str, msgs: list[dict], tier: str, agent: str = "jasper") -> AsyncIterator[dict]:
    """Yields {"delta"} | {"tool"} | {"ui"} | {"usage"}. Tool-call rounds are buffered, plain answers are streamed."""
    token = _ui.set([])
    trace: list[str] = []
    answer: list[str] = []
    try:
        async for ev in _rounds(r, agent, system, msgs, tier, trace):
            if "delta" in ev:
                answer.append(ev["delta"])
            yield ev
    finally:
        _ui.reset(token)
    _spawn_review(r, agent, msgs[-1]["content"] if msgs else "", trace, "".join(answer))


async def run_bot(slug: str, text: str, asker: str = "jasper") -> str:
    """Headless turn for a delegated bot: tool loop if the bot has tools, else a plain completion. Depth-limited."""
    from api.routes.chat2 import _persona
    from core.eventbus import announce
    from core.llm.registry import get_router

    if _depth.get() >= MAX_DEPTH:
        return "error: delegation depth limit reached"
    system, tier = _persona(slug)
    r = await get_router()
    tok = _depth.set(_depth.get() + 1)
    announce(slug, "working", bubble=text[:100])
    try:
        b = registry.routable(slug)
        with finops.attribute(slug, b.crew if b else None):
            if has_tools(slug):
                trace: list[str] = []
                out = "".join([ev["delta"] async for ev in _rounds(r, slug, system, [{"role": "user", "content": text}], tier, trace) if "delta" in ev])
                _spawn_review(r, slug, text, trace, out)
                return out
            res = await r.complete(LLMRequest(system=system, messages=[{"role": "user", "content": text}], tier=tier, max_tokens=900))
            return res.text
    finally:
        _depth.reset(tok)
        announce(slug, "idle")
