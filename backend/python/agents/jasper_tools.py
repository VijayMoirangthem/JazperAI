"""System access for Jasper: a small tool loop around the chat stream.

The LLM router has no native tool calling, so Jasper emits one call per turn as  <tool>{"name":..,"args":{..}}</tool>.
We run it (gated by core.hitl where it changes state), feed the result back and let Jasper continue (max MAX_ROUNDS).
Only Jasper gets tools; bots called through ask_bot answer as plain personas. Output is compact on purpose (token budget).
"""
import json
import re
import time
from collections.abc import AsyncIterator

from agents import orgchart
from agents.registry import BotDef, registry
from core import finops, hitl
from core.llm.types import LLMRequest, Usage
from hub.hub import ToolError, hub

MAX_ROUNDS = 4
CALL_RE = re.compile(r"<tool>\s*(\{.*?\})\s*</tool>", re.S)

TOOL_HELP = """You have system access. To use a tool, reply with ONLY one line: <tool>{"name":"NAME","args":{...}}</tool> and wait for the result, then continue.
Tools:
- list_org {} : groups, departments, bots with role and score
- ask_bot {slug,text} : delegate a task/question to a bot and get its answer
- bot_stats {} : per-bot calls, errors, thumbs, latency, score (for reviews)
- create_bot {slug,display_name,role_title,prompt,group,department,tier} : create a new bot (needs approval)
- edit_bot_prompt {slug,prompt} : change a bot's system prompt (needs approval)
- find_tool {query} : search connected MCP tools (Gmail, GitHub, files...)
- use_tool {name,arguments} : run an MCP tool by its full name (writes need approval)
Delegate to the right bot instead of doing everything yourself; prefer one tool call at a time; answer the founder concisely when done."""


def _clip(x, n: int = 1800) -> str:
    s = x if isinstance(x, str) else json.dumps(x, default=str)
    return s if len(s) <= n else s[:n] + "…"


def _bot_line(b: dict) -> str:
    extra = "" if b["enabled"] else ", inactive"
    if b["score"] is not None:
        extra += f", score {b['score']}"
    return f"{b['slug']}({b['position'][:40]}{extra})"


async def run_tool(name: str, args: dict, agent: str = "jasper") -> str:
    if name == "list_org":
        out = []
        for g in (await orgchart.tree())["groups"]:
            bots = [_bot_line(b) for b in g["bots"]]
            out.append(f"{g['label']}: " + "; ".join(bots))
        return _clip("\n".join(out), 3500)
    if name == "bot_stats":
        rows = [{k: b[k] for k in ("slug", "calls", "errors", "thumbs_up", "thumbs_down", "avg_latency_ms", "score")}
                for g in (await orgchart.tree())["groups"] for b in g["bots"] if b["enabled"]]
        return _clip(rows, 3500)
    if name == "ask_bot":
        slug = str(args.get("slug", ""))
        if slug == "jasper":
            return "error: cannot ask yourself"
        t0 = time.monotonic()
        try:
            res = await registry.message(slug, str(args.get("text", ""))[:4000])
            await orgchart.record_call(slug, True, int((time.monotonic() - t0) * 1000))
            return _clip(res["reply"])
        except LookupError:
            return f"error: bot {slug} not found or disabled"
        except Exception as e:
            await orgchart.record_call(slug, False, int((time.monotonic() - t0) * 1000))
            return f"error: {str(e)[:200]}"
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
    if name == "find_tool":
        return _clip([{"name": t["name"], "tier": t["tier"], "description": t["description"][:100], "args": list(t["schema"].get("properties", {}))}
                      for t in await hub.find_tool(str(args.get("query", "")), k=5)])
    if name == "use_tool":
        try:
            return _clip(await hub.use_tool(str(args.get("name", "")), args.get("arguments") or {}, agent=agent))
        except ToolError as e:
            return f"error: {str(e)[:300]}"
    return f"error: unknown tool {name}"


async def stream_with_tools(r, system: str, msgs: list[dict], tier: str, agent: str = "jasper") -> AsyncIterator[dict]:
    """Yields {"delta": str} | {"tool": {...}} | {"usage": Usage}. Tool-call rounds are buffered, plain answers are streamed."""
    system = f"{system}\n\n{TOOL_HELP}"
    msgs = list(msgs)
    for rnd in range(MAX_ROUNDS + 1):
        buf, mode, last_usage = "", "peek", None
        async for item in r.stream(LLMRequest(system=system, messages=msgs, tier=tier, max_tokens=1024 if rnd < MAX_ROUNDS else 700)):
            if isinstance(item, Usage):
                last_usage = item
                continue
            buf += item
            if mode == "peek" and len(buf.lstrip()) >= 6:
                mode = "tool" if buf.lstrip().startswith("<tool") else "text"
                if mode == "text":
                    yield {"delta": buf}
            elif mode == "text":
                yield {"delta": item}
        if mode == "peek" and buf:  # very short answer
            yield {"delta": buf}
            mode = "text"
        call = CALL_RE.search(buf) if mode == "tool" else None
        if not call or rnd == MAX_ROUNDS:
            if mode == "tool":  # unparseable or out of rounds: show what we have rather than nothing
                yield {"delta": CALL_RE.sub("", buf).replace("<tool>", "").strip() or "(I could not complete that action.)"}
            if last_usage:
                yield {"usage": last_usage}
            return
        try:
            spec = json.loads(call.group(1))
            name, args = str(spec.get("name", "")), spec.get("args") or {}
        except Exception:
            name, args = "?", {}
        label = f"{name} {args.get('slug', '')}".strip()
        yield {"tool": {"name": name, "label": label, "status": "running"}}
        try:
            result = await run_tool(name, args if isinstance(args, dict) else {}, agent)
        except Exception as e:
            result = f"error: {str(e)[:200]}"
        yield {"tool": {"name": name, "label": label, "status": "error" if result.startswith(("error", "blocked")) else "ok", "result": result[:300]}}
        msgs += [{"role": "assistant", "content": buf.strip()}, {"role": "user", "content": f"<tool_result name=\"{name}\">{result}</tool_result>"}]
