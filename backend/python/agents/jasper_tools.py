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

from agents import comms, connector, orgchart, skills, workspaces
from agents.registry import BotDef, registry
from core import finops, hitl, untrusted
from core.llm.types import LLMRequest, Usage
from hub.hub import ToolError, hub

MAX_ROUNDS = 4
MAX_DEPTH = 2
CALL_RE = re.compile(r"<tool(?:_call)?>\s*(?:<function=(\w+)>\s*)?(\{.*?\})\s*(?:</function>\s*)?</tool(?:_call)?>", re.S)
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
    "connect": "connect {connector} : make a service work end to end and PROVE it with a real call (gmail, calendar, drive, docs, sheets, github, slack, notion, filesystem, memory). Fixes what it can by itself (restarts, scope checks); if only the founder can act it shows ONE click card",
    "suggest_connectors": "suggest_connectors {} : recommended connectors with live status; shows the founder one-click Connect cards. Use it for any question about what to connect or how to become more capable",
    "test_connection": "test_connection {connector} : run the harmless read check on a connector",
    "llm_status": "llm_status {} : which model providers are configured, the fallback chain per tier, tokens and cost used today (per model), forecast, budgets, and which providers are cooling down. Use it for ANY question about usage, tokens left, or which provider is serving you",
    "llm_fix": "llm_fix {} : self-heal the model layer: reset circuit breakers, rebuild the chains (adds free fallback models) and test every provider for real. Run it yourself whenever a provider error happens, then retry",
    "system_status": "system_status {} : health of the whole system (database, redis, backend, connectors) in one call",
    "read_logs": "read_logs {name,lines,contains} : recent backend log lines (secrets are redacted). Use it to diagnose errors yourself",
    "google": "google {action,...} : YOUR OWN direct access to Google Drive/Docs/Sheets, real data, no delegation needed. actions: list {limit}, search {query}, read {name|file_id}, create_doc {title,text}, append {name|file_id,text}, replace {name|file_id,find,replace}, create_sheet {title}, sheet_read {name|file_id,range}, sheet_write/sheet_append {name|file_id,range,values}, create_file {title,text}, rename {name|file_id,new_name}, copy, trash, share {email,role}. Edits ask the founder to approve. NEVER describe Drive contents from memory: only copy what this tool returned",
    "open_file": "open_file {name|file_id} : OPEN a Drive file for the founder in the in-app viewer (Docs, Sheets, PDFs, images, audio/video player, text/code). Use it whenever they say open/show/play/let me see a file",
    "capability_plan": "capability_plan {need,build} : when you LACK a tool or ability, call this instead of saying you can't. It checks connected tools, connectors and skills; if one exists it says which to connect/use; if none, it files the gap and (build=true) starts a sandboxed build of the missing capability by the team (tests run, the founder approves the merge). Always follow its result",
    "gaps": "gaps {} : recurring tool/connector failures of the last 7 days and how each was resolved (fixed, needed the founder, unfixed). Use it when asked what keeps going wrong",
    "diagnose": "diagnose {text} : classify an error message (google_scope, api_disabled, connector_down, rate_limited...)",
    "clear_chat": "clear_chat {scope} : delete chat history. scope = before_now (everything above the founder's last message) | all | older_than_days:N. Shows the founder ONE confirm button (with Undo). Call it straight away; never ask first",
    "hold_meeting": "hold_meeting {group,topic} : the bots of a group (create_origins, baeit, boardmint, jazper_team) discuss a topic and their lead concludes; returns the conclusion",
    "fs_roots": "fs_roots {} : folders on this PC you may work in",
    "fs_list": "fs_list {path} : list a folder",
    "fs_read": "fs_read {path,max_chars} : read a text file (secret files such as .env are blocked)",
    "fs_search": "fs_search {query,path} : find files or text inside your workspace folders",
    "fs_write": "fs_write {path,content} : create or overwrite a file (needs approval; a .jasper-bak backup is kept)",
    "find_bot": "find_bot {need} : which bot is the right owner for a job (best 3 with fit), or says none fits",
    "remember": "remember {scope,fact} : store a lasting fact for your group (scope group) or the whole company (scope org)",
    "build_feature": "build_feature {group,task} : have a group's team build a feature in its project on a safe branch (lead plans, dev + QA bots write code and tests, tests run in a Docker sandbox); returns a run id",
    "feature_status": "feature_status {id} : progress, report and test result of a feature run",
    "merge_feature": "merge_feature {id} : ask the founder to approve merging a verified feature run (explicit approval card)",
    "evaluate_bot": "evaluate_bot {slug} : run the interview + benchmark (clearance from probation) in the background; results appear in the bot ID card",
    "improve_bot": "improve_bot {slug} : performance-improvement plan: propose a better prompt, benchmark it, apply only if it scores clearly higher (asks approval)",
    "alerts": "alerts {} : open alerts and recent incidents with their runbook (what is wrong now and how to fix it)",
    "list_skills": "list_skills {} : the shared skill library (name: when to use)",
    "view_skill": "view_skill {name} : load a skill's step-by-step procedure before doing that kind of task",
    "save_skill": "save_skill {name,description,body} : create or improve a reusable skill (numbered steps, no secrets)",
}
FS = ["fs_roots", "fs_list", "fs_read", "fs_search", "fs_write"]
LEADS = {"ceo-create-origins", "ceo-baeit", "lead-boardmint", "vp-tech-ops"}
TOOLS_FOR: dict[str, list[str]] = {
    "jasper": ["list_org", "find_bot", "remember", "clear_chat", "google", "open_file", "capability_plan", "gaps", "diagnose", "llm_status", "llm_fix", "system_status", "read_logs", *FS, "ask_bot", "bot_stats", "create_bot", "edit_bot_prompt", "run_chaos", "slo", "list_connections", "suggest_connectors", "alerts", "evaluate_bot", "improve_bot", "hold_meeting", "build_feature", "feature_status", "merge_feature", "list_skills", "view_skill", "save_skill"],  # raw MCP tools are deliberately not Jasper's: it delegates (messenger, connector, leads)
    "connector": ["google", "open_file", "capability_plan", "list_connections", "suggest_connectors", "connect", "test_connection", "find_tool", "use_tool", "list_skills", "view_skill", "save_skill"],
    "messenger": ["find_tool", "use_tool", "list_connections", "ask_bot", "list_skills", "view_skill"],
    "bot-reviewer": ["list_org", "bot_stats", "evaluate_bot", "improve_bot", "alerts", "list_skills", "view_skill"],
    "bot-creator": ["list_org", "evaluate_bot", "list_skills"],
    "chaosbot": ["slo", "run_chaos", "alerts"],
}
INTRO = 'You have system access. To use a tool reply with ONLY one line: <tool>{"name":"NAME","args":{...}}</tool> and wait for the result, then continue. Tools:\n'
RULES = ("\nHierarchy: Jasper delegates to group leads; leads delegate to their members, hold meetings for decisions and record lasting decisions with remember. Use find_bot to pick the right owner. Questions about what to connect or how to get smarter: call suggest_connectors, then give a short prioritised answer (top 3 and why for THIS founder) and mention the cards. Routing: anything about email goes to `messenger` (it checks Gmail and asks `connector` itself); connections go to `connector`. One tool call at a time. Delegate to the right specialist instead of doing everything yourself. If a service is not connected, ask `connector` to connect it "
         "(it checks the vault/.env and asks the founder only if something is missing). Never ask the founder to paste secrets into chat: a secure card is shown for that. "
         "Missing ability? Never say \"I can't\" or \"I don't have a tool\": call capability_plan {need} and follow it (use an existing tool, connect a connector, or start a sandboxed build). "
         "Google Drive, Docs and Sheets: use the `google` tool YOURSELF (list, search, read, append, replace, create...). Do not delegate Drive work to other bots and never state file names, dates or document contents that a tool result did not show; if a call fails say so plainly. "
         "Never answer a question about usage, tokens, providers, errors or system health with \"I can't check\": call llm_status, system_status or read_logs and answer from the result; if a provider is failing, call llm_fix yourself first. When asked how to become smarter/more powerful, call suggest_connectors and list the top 3 in one line each. "
         "Style: casual, short, straight to the point (1-2 sentences, result first; no greetings, no apologies, no menus of options). Power: you can really act (delegate, connect services, clear chat, run tools). Never say \"I can't\" until you have checked your tools and your team; if another bot can do it, delegate. Safety that is not dumb: reversible actions (create, edit, rename, copy, move) just do them and mention it; irreversible or outward-facing ones (delete, send, share, spend) get exactly ONE confirm tap, never a questionnaire. Proactive rule: never ask the founder to choose between solutions. Pick the one that needs the least effort from them, do it, and report the RESULT. Never say something is connected, done or available unless a tool result in this conversation proves it (quote the evidence in one line). If a capability is missing (Drive, Docs, Sheets, mail, calendar...), delegate to `connector` with the exact task, e.g. ask_bot connector: \"list the 10 most recently modified Drive files\"; it fixes what it can and shows the founder at most ONE click. Never say you will do something and then stop: finish it or say precisely what blocked it. "
         "Answer the founder concisely when done.")


def tools_for(slug: str) -> list[str]:
    """Static allowlist, else a default set for bots whose group has a workspace (leads also delegate and hold meetings)."""
    off = set(orgchart.SETTINGS.get(slug, {}).get("tools_off", []))  # the founder can switch individual tools off per bot
    if slug in TOOLS_FOR:
        base = TOOLS_FOR[slug]
    elif slug in LEADS:
        base = ["list_org", "find_bot", "ask_bot", "hold_meeting", "feature_status", "remember", "list_skills", "view_skill", *(FS if workspaces.has_workspace(slug) else [])]
    elif workspaces.has_workspace(slug):
        base = [*FS, "ask_bot", "remember", "list_skills", "view_skill"]
    else:
        base = []
    return [t for t in base if t not in off]


def has_tools(slug: str) -> bool:
    return bool(tools_for(slug))


async def system_for(slug: str, system: str) -> str:
    lines = "\n".join("- " + HELP[t] for t in tools_for(slug))
    cat = await skills.catalogue()
    return f"{system}\n\n{INTRO}{lines}{RULES}\n{untrusted.STANDING_RULE}" + (f"\n\nSkills you can load with view_skill:\n{cat}" if cat else "")


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
    return {"id": c["id"], "name": c.get("name", ""), "connected": c.get("connected", False), "ready": c.get("ready", False), "missing": c.get("missing", []),
            "needs_google_signin": bool(c.get("oauth") and not c["oauth"]["connected"]), "detail": c.get("detail", ""), "untested": c.get("untested", False)}


def _path(args: dict) -> str:
    """Models name the path argument in many ways; accept the common ones."""
    for k in ("path", "dir", "directory", "folder", "file", "filepath", "file_path", "name"):
        if args.get(k):
            return str(args[k])
    return ""


async def _gate(action: str, summary: str, agent: str) -> bool:
    """hitl.gate that escalates to explicit approval (Tier 3) and quotes the untrusted source when the request is tainted."""
    return await hitl.gate(action, summary + untrusted.approval_note(), agent, min_tier=3 if untrusted.is_tainted() else 0)


def _ext(source: str, agent: str, result: str, always: bool = True) -> str:
    """Wrap an external tool result as untrusted data (errors and our own status text are left alone)."""
    if not always or result.startswith(("error", "blocked", "no ")):
        return result
    return untrusted.wrap(source, result)


async def run_tool(name: str, args: dict, agent: str) -> str:
    if name not in tools_for(agent):
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
        if agent != "jasper" and slug not in ("jasper", "connector", "messenger") and workspaces.GROUP_OF.get(slug) != workspaces.GROUP_OF.get(agent):
            return f"error: {slug} is in another group; ask your lead or Jasper to delegate across groups"
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
        if not await _gate("bot.create", f"Create bot {slug}: {str(args.get('role_title', ''))[:120]}", agent):
            return "blocked: founder did not approve"
        b = BotDef(slug=slug, display_name=str(args.get("display_name") or slug), role_title=str(args.get("role_title", "")), crew=str(args.get("group", "personal")),
                   prompt=str(args.get("prompt", "")), model_policy={"default_tier": args.get("tier", "standard")}, lifecycle="probation")
        await registry.upsert(b)
        await orgchart.place(slug, str(args.get("group", "jazper_team")), str(args.get("department", "")), b.role_title)
        from agents import lifecycle
        asyncio.create_task(_later(lifecycle.clear(slug), 30.0))  # onboarding: interview + benchmark before the bot is cleared
        return f"created {slug} (probation) in {args.get('group', 'jazper_team')}; its interview and benchmark start shortly"
    if name == "edit_bot_prompt":
        slug = str(args.get("slug", ""))
        if not any(r["slug"] == slug for r in registry.roster()):
            return f"error: unknown bot {slug}"
        if not await _gate("bot.edit", f"Change system prompt of {slug}", agent):
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
        if not await _gate("chaos.run", f"Run chaos experiment {exp} (sandbox only)", agent):
            return "blocked: founder did not approve"
        res = await chaos.run_all() if exp == "all" else [await chaos.run(exp)]
        return _clip([{k: r[k] for k in ("name", "passed", "detail", "ms")} for r in res])
    if name == "find_tool":
        found = await hub.find_tool(str(args.get("query", "")), k=5)
        if not found:
            return "no connected tool matches; the service is probably not connected (ask connector to connect it)"
        return _clip([{"name": t["name"], "tier": t["tier"], "description": t["description"][:100], "args": list(t["schema"].get("properties", {}))} for t in found])
    if name == "use_tool":
        from agents import healer
        tname, targs, fixed_note = str(args.get("name", "")), args.get("arguments") or {}, ""
        for attempt in (1, 2):  # a failure is diagnosed and healed (restart, scope, API, rate limit...) and the call retried once, before the model sees an error
            try:
                res = await hub.use_tool(tname, targs, agent=agent, taint=untrusted.is_tainted(), note=untrusted.approval_note())
                err = json.dumps(res, default=str)[:500] if healer.is_failure(res) else None
            except ToolError as e:
                res, err = None, str(e)[:500]
            if err is None:
                return _ext(tname.split(".")[0] or "mcp", agent, _clip(res), always=not res.get("blocked")) + fixed_note
            out = await healer.heal(tname, targs, err, agent, attempt)
            if out.request:
                _push_ui(out.request)
                return f"Needs ONE founder click: {out.message} The card is shown. Say it in one short sentence; when they have clicked, repeat this call."
            if out.retry and attempt == 1:
                fixed_note = f" [auto-fixed: {out.message}]"
                continue
            return f"error ({out.kind}): {out.message}"
        return "error: still failing after auto-fix"
    if name == "google":
        from agents import healer
        from core.services import drive_service as ds
        act = str(args.get("action", "")).strip().lower()
        TOOL = {"list": "drive_list_recent", "search": "drive_search", "read": "drive_read_file", "create_doc": "docs_create", "append": "docs_append", "replace": "docs_replace",
                "create_sheet": "sheets_create", "sheet_read": "sheets_read", "sheet_write": "sheets_write", "sheet_append": "sheets_append", "create_file": "drive_create_file",
                "rename": "drive_rename", "copy": "drive_copy", "trash": "drive_trash", "share": "drive_share"}
        WRITES = {"create_doc", "append", "replace", "create_sheet", "sheet_write", "sheet_append", "create_file", "rename", "copy", "trash", "share"}
        if act not in TOOL:
            return "error: action must be one of " + ", ".join(TOOL)

        async def file_id() -> str | None:
            i = args.get("file_id") or args.get("id")
            if i:
                return str(i)
            q = str(args.get("name") or args.get("query") or "").strip()
            hits = await asyncio.to_thread(ds.search, q, 5) if q else []
            return hits[0]["id"] if hits else None

        def table(files: list[dict]) -> str:
            kind = {"application/vnd.google-apps.document": "Doc", "application/vnd.google-apps.spreadsheet": "Sheet", "application/vnd.google-apps.presentation": "Slides", "application/vnd.google-apps.folder": "Folder", "application/pdf": "PDF"}
            return "\n".join(f"{i + 1}. {f['name']} ({kind.get(f.get('mimeType', ''), 'File')}, modified {str(f.get('modifiedTime', ''))[:10]}, id {f['id']})" for i, f in enumerate(files)) or "(no files)"

        async def run() -> str:
            fid = await file_id() if act not in ("list", "search", "create_doc", "create_sheet", "create_file") else None
            if act in ("read", "append", "replace", "sheet_read", "sheet_write", "sheet_append", "rename", "copy", "trash", "share") and not fid:
                return "error: no such file found; give a file_id or a name that exists in Drive"
            if act in WRITES:  # edits need approval (Tier 2); trash/share are Tier 3 - same gate as every other write
                tier_action = "mcp.admin" if act in ("trash", "share") else "mcp.write"
                if not await hitl.gate(tier_action, f"google {act} {json.dumps({k: str(v)[:80] for k, v in args.items()})[:260]}", agent):
                    return "blocked: the founder did not approve this change"
            if act == "list":
                return "REAL Drive data, newest first (copy it exactly, add nothing):\n" + table(await asyncio.to_thread(ds.list_recent, min(int(args.get("limit", 10) or 10), 50), args.get("folder_id")))
            if act == "search":
                return "REAL Drive data (copy exactly):\n" + table(await asyncio.to_thread(ds.search, str(args.get("query") or args.get("name") or ""), 20))
            if act == "read":
                r = await asyncio.to_thread(ds.read_file, fid, int(args.get("max_chars", 12000) or 12000))
                return f"REAL content of '{r.get('name')}' (modified {str(r.get('modifiedTime', ''))[:10]}):\n{r.get('content') or r.get('note')}"
            if act == "create_doc":
                f = await asyncio.to_thread(ds.create_doc, str(args.get("title") or args.get("name") or "Untitled"), str(args.get("text", "")), args.get("parent_id"))
                return f"created Doc '{f['name']}' id {f['id']} {f.get('webViewLink', '')}"
            if act == "create_sheet":
                f = await asyncio.to_thread(ds.create_sheet, str(args.get("title") or args.get("name") or "Untitled"), args.get("parent_id"))
                return f"created Sheet '{f['name']}' id {f['id']} {f.get('webViewLink', '')}"
            if act == "create_file":
                f = await asyncio.to_thread(ds.create_file, str(args.get("title") or args.get("name") or "note.txt"), str(args.get("text", "")), str(args.get("mime_type", "text/plain")), args.get("parent_id"))
                return f"created file '{f['name']}' id {f['id']}"
            if act == "append":
                return str(await asyncio.to_thread(ds.docs_append, fid, str(args.get("text", ""))))
            if act == "replace":
                return str(await asyncio.to_thread(ds.docs_replace, fid, str(args.get("find", "")), str(args.get("replace", ""))))
            if act == "sheet_read":
                return str(await asyncio.to_thread(ds.sheets_read, fid, str(args.get("range", "A1:Z50"))))
            if act in ("sheet_write", "sheet_append"):
                fn = ds.sheets_write if act == "sheet_write" else ds.sheets_append
                vals = args.get("values")
                vals = json.loads(vals) if isinstance(vals, str) else vals
                return str(await asyncio.to_thread(fn, fid, str(args.get("range", "A1")), vals or []))
            if act == "rename":
                return str(await asyncio.to_thread(ds.rename_file, fid, str(args.get("new_name", ""))))
            if act == "copy":
                return str(await asyncio.to_thread(ds.copy_file, fid, args.get("new_name"), args.get("parent_id")))
            if act == "trash":
                return str(await asyncio.to_thread(ds.trash_file, fid))
            return str(await asyncio.to_thread(ds.share_file, fid, str(args.get("email", "")), str(args.get("role", "reader"))))

        for attempt in (1, 2):  # a failure is diagnosed and healed (API off, scope, sign-in...) and retried once; only then does the founder get ONE card
            try:
                return _clip(await run(), 4000)
            except Exception as e:
                out = await healer.heal("google-workspace." + TOOL[act], args, str(e), agent, attempt)
                if out.request:
                    _push_ui(out.request)
                    return f"Needs ONE founder click: {out.message} The card is shown. Say it in one short sentence; when they click, repeat this call."
                if out.retry and attempt == 1:
                    continue
                return f"error ({out.kind}): {out.message}"
    if name == "open_file":
        from core.services import drive_service as ds
        try:
            fid = args.get("file_id") or args.get("id")
            hits = [await asyncio.to_thread(ds.get_file, str(fid))] if fid else await asyncio.to_thread(ds.search, str(args.get("name") or args.get("query") or ""), 5)
        except Exception as e:
            return f"error: {str(e)[:200]}"
        if not hits:
            return "error: no file with that name in Drive"
        f = hits[0]
        _push_ui({"kind": "file", "connector": "drive", "file_id": f["id"], "name": f["name"], "mime": f.get("mimeType", ""), "open": True})
        return f"Opened '{f['name']}' in the viewer window (the founder sees it now). One short line to confirm, nothing else."
    if name == "capability_plan":
        from agents import healer
        need = str(args.get("need", "")).strip()[:300]
        if not need:
            return "error: say what you need to be able to do"
        words = [w for w in re.findall(r"[a-z0-9]+", need.lower()) if len(w) > 3]
        found = await hub.find_tool(need, 3)
        have = [f"{h['name']}: {str(h.get('description', ''))[:80]}" for h in found]
        options = [f"{c} ({spec['name']})" for c, spec in connector.catalogue().items() if any(w in (c + " " + spec["name"] + " " + spec.get("needs", "")).lower() for w in words)]
        if have:
            return "You already have tool(s) that may do it: " + "; ".join(have) + ". Use them (use_tool) instead of saying you cannot."
        if options:
            return "No connected tool yet, but a connector exists: " + "; ".join(options[:3]) + ". Call connect on it now, then continue the task."
        await healer._ledger("missing_capability", need, "no tool, no connector", "gap_filed")
        if str(args.get("build", "true")).lower() in ("true", "1", "yes"):
            res = await run_tool("build_feature", {"group": "jazper_team", "task": f"Add a capability to Sir Jasper AI so that the assistant can: {need}. Prefer an MCP connector or a small tool in backend/python; include tests."}, agent)
            return f"Nothing existing covers '{need}'. I filed the gap and started a sandboxed build: {str(res)[:200]}. Tell the founder in one line; they approve the merge when tests pass."
        return f"Nothing existing covers '{need}'. Gap filed. Offer to build it (capability_plan with build=true)."
    if name == "gaps":
        from agents import healer
        return _clip(await healer.recent_gaps(), 2500)
    if name == "diagnose":
        from agents import healer
        kind, why = healer.classify(str(args.get("text", "")))
        return f"{kind}: {why}"
    if name == "list_connections":
        return _clip([_conn_line(c) for c in await connector.overview()], 3000)
    if name == "suggest_connectors":
        items = await connector.recommendations()
        _push_ui({"kind": "suggestions", "items": items})
        lines = [f"{i + 1}. {x['name']} [{x['status']}]: {x['why']}" for i, x in enumerate(items)]
        return "One-click cards are shown to the founder. Recommendations in priority order (tailor your answer to what you know about them, say what each unlocks, and which to do first):\n" + "\n".join(lines)
    if name in ("connect", "test_connection"):
        raw = str(args.get("connector", ""))
        cid = connector.resolve(raw) or (raw if connector.capability_of(raw) else None)
        if not cid:
            return f"error: unknown connector; choose from {list(connector.catalogue())}"
        st = await (connector.connect(raw if connector.capability_of(raw) else cid) if name == "connect" else connector.test(cid))
        req = st.get("request")
        if req:
            _push_ui(req)
            what = "a secure credentials card" if req["kind"] == "credentials" else "ONE Google approval button"
            return (f"Not working yet, and only the founder can do the next step. They are being shown {what} in chat ({req.get('reason', '')}). Say in ONE short sentence what to click; "
                    "do not offer alternatives and do not ask questions. The moment they have clicked, call connect again and carry on with their original request. Never ask them to type secrets in chat.")
        if st.get("ok") is False:
            return _clip(f"NOT verified: {st.get('detail', 'unknown problem')}. Tell the founder exactly this in one or two sentences (include the link if there is one); do not claim success.")
        if st.get("verified"):
            return _clip(f"VERIFIED by a real call: {st.get('capability')} works ({st.get('tools')} tools). Evidence: {st.get('evidence', '')[:240]}. Now do the founder's original task with use_tool and show the actual result.")
        return _clip(_conn_line(st))
    if name in ("llm_status", "llm_fix"):
        from core.llm import registry as llm_reg
        from memory.db import aio
        router = await llm_reg.get_router()
        if name == "llm_fix":  # self-heal: clear circuit breakers, rebuild the chains (adds the free safety net), then really test every provider
            for r in router.routers.values():
                r.reset_breakers()
            llm_reg.invalidate()
            router = await llm_reg.get_router()
        provs = await aio.fetch("SELECT slug, kind, enabled, secret_env FROM shared.llm_providers ORDER BY slug")
        chains = {t: [f"{getattr(p, 'name', '?')}" for p in r.chain] for t, r in router.routers.items()}
        down = {t: {k: round(v - time.monotonic()) for k, v in r._open_until.items() if v > time.monotonic()} for t, r in router.routers.items()}
        summary = await finops.summary()
        out = {"providers": [{"slug": p["slug"], "kind": p["kind"], "enabled": p["enabled"]} for p in provs], "chains": chains,
               "breaker_open_seconds_left": {t: d for t, d in down.items() if d},
               "today": summary["today"], "by_model": summary["by_model"][:6], "forecast": summary["forecast"], "budgets": summary["budgets"]}
        if name == "llm_fix":
            async def probe(slug: str, model: str):
                try:
                    return slug, model, await asyncio.wait_for(llm_reg.test_provider(slug, model), 20)
                except Exception as e:
                    return slug, model, {"ok": False, "error": str(e)[:80]}
            pairs, seen = [], set()
            for r in router.routers.values():
                for p in r.chain:
                    k = getattr(p, "name", "")
                    m = getattr(p, "models", {}).get("standard") if hasattr(p, "models") else None
                    if k and m and (k, m) not in seen:
                        seen.add((k, m))
                        pairs.append((k, m))
            res = await asyncio.gather(*[probe(s, m) for s, m in pairs[:8]])
            out["tests"] = [{"provider": s, "model": m, "ok": r.get("ok"), "problem": r.get("status") or r.get("error")} for s, m, r in res]
            out["note"] = "breakers reset and chains rebuilt; if every Groq test says rate_limited its free daily quota is used up and the free opencode models take over automatically"
        return _clip(out, 3500)
    if name == "system_status":
        from api.routes import system as system_routes
        h = await system_routes.health()
        return _clip({"ok": h.get("ok"), "checks": {k: ("ok " if v.get("ok") else "FAIL ") + str(v.get("detail", ""))[:80] for k, v in h.get("checks", {}).items()},
                      "connectors": [{"id": c["id"], "connected": c.get("connected")} for c in await connector.overview()]}, 3000)
    if name == "read_logs":
        from api.routes import system as system_routes
        r = await system_routes.logs(str(args.get("name", "backend")), min(int(args.get("lines", 60) or 60), 200))
        needle = str(args.get("contains", "")).lower()
        lines = [l for l in r["lines"] if not needle or needle in l.lower()]
        return _clip(lines[-60:], 3500)
    if name == "clear_chat":
        scope = str(args.get("scope", "before_now")).strip()
        if not (scope in ("before_now", "all") or scope.startswith("older_than_days:")):
            return "error: scope must be before_now, all or older_than_days:N"
        label = {"before_now": "Delete everything above this line?", "all": "Delete this whole chat?"}.get(scope) or f"Delete messages older than {scope.split(':')[-1]} days?"
        _push_ui({"kind": "confirm", "connector": "chat", "action": "clear_chat", "scope": scope, "label": label})
        return "Showed ONE confirm button (it has Undo). Reply with one short line like 'Tap delete to confirm.' and nothing else."
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
    if name == "fs_roots":
        return _clip([f"{r['path']} ({r['mode']})" for r in workspaces.roots_for(agent)] or "no folders attached")
    if name == "fs_list":
        if not _path(args):  # no path given: show the folders the bot may use instead of failing
            return _clip([r["path"] for r in workspaces.roots_for(agent)] or "no folders attached")
        return _ext("file", agent, _clip(workspaces.list_dir(agent, _path(args)), 3000))
    if name == "fs_read":
        return _ext("file", agent, _clip(workspaces.read_file(agent, _path(args), min(int(args.get("max_chars", 8000) or 8000), workspaces.MAX_READ)), workspaces.MAX_READ))
    if name == "fs_search":
        return _ext("file", agent, _clip(await asyncio.to_thread(workspaces.search, agent, str(args.get("query", "")), _path(args)), 3000))
    if name == "fs_write":
        p, why = workspaces.write_file(agent, _path(args), str(args.get("content", "")))
        if not p:
            return "error: " + why
        if not await _gate("file.write", f"{agent} writes {p} ({len(str(args.get('content', '')))} chars)", agent):
            return "blocked: founder did not approve"
        out = await asyncio.to_thread(workspaces.commit_write, p, str(args.get("content", "")))
        await comms.log(agent, "tool:fs_write", "event", out)
        return out
    if name == "find_bot":
        return _clip(await _find_bot(str(args.get("need", ""))), 2000)
    if name in ("remember", "save_skill") and untrusted.is_tainted():
        return ("blocked: this request contains untrusted external content (" + ", ".join(untrusted.current().sources) + "). I will not store memories or skills from it; "
                "ask the founder to say it directly if it should be remembered.")
    if name == "remember":
        from core.llm.registry import get_router
        from memory import consolidate
        scope, fact = str(args.get("scope", "group")), str(args.get("fact", ""))[:500]
        ns = {"group": f"group.{workspaces.GROUP_OF.get(agent, 'none')}", "org": "org", "founder": "fact"}.get(scope)
        if not ns or not fact or (scope == "founder" and agent != "jasper"):
            return "error: scope must be group or org (founder only for jasper) and fact is required"
        r = await consolidate.learn(await get_router(), fact, 0.7, ns)
        return f"remembered in {ns}: {r['action']}"
    if name in ("evaluate_bot", "improve_bot"):
        from agents import lifecycle
        slug = str(args.get("slug", ""))
        if not any(r["slug"] == slug for r in registry.roster()):
            return f"error: unknown bot {slug}"
        asyncio.create_task(lifecycle.clear(slug) if name == "evaluate_bot" else lifecycle.pip(slug))
        return f"{'clearance' if name == 'evaluate_bot' else 'improvement plan'} started for {slug}; it takes a few minutes and the result is added to its ID card history."
    if name == "alerts":
        from core import alerts
        a, inc = await alerts.list_alerts(10), await alerts.list_incidents(8)
        return _clip({"open_alerts": [f"{x['severity']}: {x['title']} (runbook {x['runbook']})" for x in a["open"]] or "none",
                      "recent_incidents": [f"{x['kind']} from {x['source']}: {x['summary'][:90]}" for x in inc]}, 2500)
    if name == "build_feature":
        from agents import feature_flow
        group, task = str(args.get("group", "")), str(args.get("task", ""))
        repo = next((w["path"] for w in workspaces._cache.get(group, [])), None)
        if not repo or len(task) < 8:
            return "error: give a group with a workspace (baeit, boardmint, create_origins) and a task description"
        if not await _gate("git.create_branch", f"Start a feature run in {group}: {task[:160]}", agent):
            return "blocked: founder did not approve"
        try:
            run = await feature_flow.start(group, task, repo, agent)
        except ValueError as e:
            return f"error: {e}"
        return f"started run {run['id']} for {group} (lead {run['lead']}); it works in the background. Use feature_status {run['id']} to follow it."
    if name == "feature_status":
        from agents import feature_flow
        r = feature_flow.RUNS.get(str(args.get("id", "")))
        if not r:
            return "error: unknown run id"
        return _clip({"status": r["status"], "attempt": r.get("attempt"), "plan": r.get("plan", {}).get("summary"), "events": [e["who"] + ": " + e["text"] for e in r["events"][-6:]],
                      "report": r.get("report"), "merge": r.get("merge"), "error": r.get("error")}, 2500)
    if name == "merge_feature":
        from agents import feature_flow
        r = feature_flow.RUNS.get(str(args.get("id", "")))
        if not r or r.get("status") != "verified" or r.get("merge") in ("awaiting-approval", "merged"):
            return "error: only a verified, not-yet-merged run can be merged"
        r["merge_handle"] = asyncio.create_task(feature_flow.merge(r["id"]))
        return "an approval card was sent to the founder; the merge happens only if they approve it"
    if name == "list_skills":
        return _clip(await skills.catalogue(40) or "(no skills yet)", 3000)
    if name == "view_skill":
        s = await skills.view(str(args.get("name", "")))
        return _clip(f"{s['name']} v{s['version']}\n{s['body']}", 3500) if s else "error: no such skill"
    if name == "save_skill":
        return json.dumps(await skills.save(str(args.get("name", "")), str(args.get("description", "")), str(args.get("body", "")), agent))
    return f"error: unknown tool {name}"


async def _find_bot(need: str) -> list[dict]:
    """Which bot fits this need? Keyword overlap over role, department and duties (prompt head); returns the best 3 with their fit.
    No match means no fit: ask bot-creator to design one."""
    words = {w for w in re.split(r"[^a-z0-9]+", need.lower()) if len(w) > 2}
    out = []
    for g in (await orgchart.tree())["groups"]:
        if g["id"] == "legacy":
            continue
        for b in g["bots"]:
            if not b["enabled"]:
                continue
            d = registry.get(b["slug"])
            hay = f"{b['display_name']} {b['position']} {b['department']} {(d.prompt[:300] if d else '')}".lower()
            hits = sum(w in hay for w in words)
            if hits:
                out.append({"slug": b["slug"], "role": b["position"][:60], "group": g["id"], "fit": hits, "quality": b["score"]})
    out.sort(key=lambda x: (-x["fit"], -(x["quality"] or 0)))
    return out[:3] or [{"note": "no bot fits this need; ask bot-creator to design one"}]


_OPEN_RE = re.compile(r"<tool(?:_call)?>\s*(?:<function=(\w+)>\s*)?")


def parse_call(buf: str):
    """Find a tool call anywhere in the text and decode its JSON properly (arguments may contain nested objects).
    Returns (name, args, start, end) or None when there is no well-formed call. Accepts <tool>{"name","args"}</tool>,
    <tool_call>{"name","arguments"}</tool_call> and <tool_call><function=NAME>{args}</function></tool_call>."""
    m = _OPEN_RE.search(buf)
    if not m:
        t = buf.lstrip()
        if t.startswith("{"):  # some models drop the tags and emit the bare JSON call
            try:
                obj, end = json.JSONDecoder().raw_decode(t)
            except ValueError:
                return None
            if isinstance(obj, dict) and obj.get("name") and ("args" in obj or "arguments" in obj):
                args = obj.get("args") or obj.get("arguments") or {}
                return str(obj["name"]), (args if isinstance(args, dict) else {}), len(buf) - len(t), len(buf) - len(t) + end
        return None
    i = buf.find("{", m.end())
    if m.group(1) and (i < 0 or buf.find("</function>", m.end()) in range(m.end(), i + 1)):  # named call with no arguments
        close = re.compile(r"\s*(?:</function>\s*)?(?:</tool(?:_call)?>)?").match(buf, m.end())
        return m.group(1), {}, m.start(), close.end() if close else m.end()
    if i < 0:
        return None
    try:
        obj, end = json.JSONDecoder().raw_decode(buf, i)
    except ValueError:
        return None
    if m.group(1):
        name, args = m.group(1), obj
    else:
        name, args = str(obj.get("name", "")), obj.get("args") or obj.get("arguments") or obj.get("parameters") or {}
    if isinstance(obj, dict) and not m.group(1) and not name and isinstance(obj.get("tool"), str):  # {"tool": "x", "args": {...}}
        name = obj["tool"]
    args = args if isinstance(args, dict) else {}
    if name in ("tool", "function", "call", "tool_call", "use") and isinstance(args.get("name"), str):  # {"name":"tool","args":{"name":"x",...}}
        inner = args.get("arguments") or args.get("args") or {k: v for k, v in args.items() if k != "name"}
        name, args = args["name"], (inner if isinstance(inner, dict) else {})
    close = re.compile(r"\s*(?:</function>\s*)?(?:</tool(?:_call)?>)?").match(buf, end)
    return name, args, m.start(), close.end() if close else end


async def _stream_retry(r, req):
    """r.stream with one retry after a short pause; a persistent provider failure becomes a readable message instead of an exception
    (Groq's free tier rate-limits bursts, and a failed sub-call must not blank the whole delegation chain)."""
    for attempt in (1, 2, 3):
        got = False
        try:
            async for item in r.stream(req):
                got = True
                yield item
            return
        except Exception as e:
            await comms.log("system", "llm", "event", f"provider error (attempt {attempt}, {'mid-stream' if got else 'before output'}): {type(e).__name__}: {str(e)[:300]}")
            if attempt == 3 or got:
                from core import alerts
                await alerts.incident("llm", f"{type(e).__name__}: {str(e)[:200]}", {"attempt": attempt})
            if got or attempt == 3:
                yield "(The model provider is busy or rate-limited right now - " + str(e)[:80] + ". Please try again in a minute.)"
                return
            try:  # heal between attempts: a tripped circuit breaker must not keep every provider "down"
                for rr in r.routers.values():
                    rr.reset_breakers()
            except Exception:
                pass
            await asyncio.sleep(3 * attempt)  # 3 s, then 6 s: lets a per-minute limit on the free tier recover


async def _rounds(r, slug: str, system: str, msgs: list[dict], tier: str, trace: list[str]) -> AsyncIterator[dict]:
    """Core loop shared by streaming (Jasper) and headless (run_bot) use."""
    system = await system_for(slug, system)
    msgs = list(msgs)
    tier = "standard" if tier == "light" else tier  # the light model returns empty text for tool-call prompts
    for rnd in range(MAX_ROUNDS + 1):
        buf, emitted, mode, last_usage = "", 0, "text", None
        stream = _stream_retry(r, LLMRequest(**{"system": system, "messages": msgs, "tier": tier, "max_tokens": 1024 if rnd < MAX_ROUNDS else 700, **orgchart.llm_kwargs(slug)}))
        async for item in stream:
            if isinstance(item, Usage):
                last_usage = item
                continue
            buf += item
            if mode == "text":
                i = buf.find("<tool")
                if i < 0 and emitted == 0 and buf.lstrip().startswith("{"):
                    i = len(buf) - len(buf.lstrip())  # possible bare-JSON call: buffer until we know
                if i >= 0:  # a call may follow prose: stop streaming at it and buffer the rest
                    mode, safe = "tool", i
                else:
                    safe = len(buf) - 5  # hold back a tail that could be the start of "<tool"
                if safe > emitted:
                    yield {"delta": buf[emitted:safe]}
                    emitted = safe
        if not buf.strip() and rnd < MAX_ROUNDS:  # empty completion (the model produced only hidden reasoning): nudge once instead of ending silently
            msgs += [{"role": "assistant", "content": "(no output)"}, {"role": "user", "content": "Continue: use the information you have to answer, or call the next tool."}]
            continue
        call = parse_call(buf) if mode == "tool" else None
        looks_like_call = mode == "tool" and not call and (buf.lstrip().startswith("<tool") or ('"name"' in buf and ('"args"' in buf or '"arguments"' in buf)))
        if looks_like_call and rnd < MAX_ROUNDS:  # malformed call (usually unescaped quotes in an argument): tell the model and let it retry
            await comms.log(slug, "system", "event", "malformed tool call, asked to retry: " + buf.strip()[:160])
            msgs += [{"role": "assistant", "content": buf.strip()[:600]},
                     {"role": "user", "content": "<tool_result>error: that tool call was not valid JSON. Send ONE valid call again; do not put double quotes inside string values (use simple search words).</tool_result>"}]
            continue
        if mode == "tool" and not call and not looks_like_call:
            yield {"delta": buf}  # it was an ordinary JSON-looking answer, not a call
            if last_usage:
                yield {"usage": last_usage}
            return
        if mode == "text" and len(buf) > emitted:
            yield {"delta": buf[emitted:]}
        if not call or rnd == MAX_ROUNDS:
            if mode == "tool":
                rest = (buf[emitted:call[2]] if call else buf[emitted:]).replace("<tool>", "").replace("<tool_call>", "").strip()
                yield {"delta": rest or ("" if emitted else "(I could not complete that action.)")}
            if last_usage:
                yield {"usage": last_usage}
            return
        name, args = (call[0], call[1]) if call else ("?", {})
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


async def _later(coro, delay: float = 25.0):
    """Run background learning after the foreground request is done so it does not eat the same per-minute model budget."""
    await asyncio.sleep(delay)
    return await coro


def _spawn_review(r, slug: str, user_text: str, trace: list[str], answer: str) -> None:
    """After a tool-using turn: maybe save/patch a skill, and store the bot's own lessons in its separate memory namespace."""
    if len(trace) >= 2 and answer:  # only multi-step work is worth learning from
        from memory import consolidate
        asyncio.create_task(_later(skills.review_turn(r, slug, user_text, " | ".join(trace), answer)))
        grp = workspaces.GROUP_OF.get(slug)
        asyncio.create_task(_later(consolidate.consolidate_turn(r, user_text, answer + " Steps: " + " | ".join(trace)[:600], ns=f"bot.{slug}", bot=True,
                                                                extra_ns=(f"group.{grp}",) if grp and grp not in ("legacy", "chief") else ())))


async def stream_with_tools(r, system: str, msgs: list[dict], tier: str, agent: str = "jasper") -> AsyncIterator[dict]:
    """Yields {"delta"} | {"tool"} | {"ui"} | {"usage"}. Tool-call rounds are buffered, plain answers are streamed."""
    token = _ui.set([])
    scope = untrusted.begin()  # one taint scope per request; delegated bots share it
    trace: list[str] = []
    answer: list[str] = []
    tainted = False
    try:
        last = str(msgs[-1].get("content", "")) if msgs else ""
        if '<untrusted source="attachment' in last:  # attachments the founder sent are untrusted data too; carry over what the scan found
            tn = untrusted.current()
            tn.sources.append("attachment")
            for fl in re.findall(r'<untrusted source="attachment" flags="([^"]*)"', last):
                tn.flags += [x for x in fl.split(",") if x and x not in tn.flags]
            tn.suspicious = bool(tn.flags)
        async for ev in _rounds(r, agent, system, msgs, tier, trace):
            if "delta" in ev:
                answer.append(ev["delta"])
            if "tool" in ev and untrusted.is_tainted() and ev["tool"].get("status") != "running":
                ev["tool"]["untrusted"] = ", ".join(untrusted.current().sources)
            yield ev
        tainted = untrusted.is_tainted()
        if tainted:
            tn = untrusted.current()
            await comms.log(agent, "system", "event", f"turn tainted by {', '.join(tn.sources)}; flags: {', '.join(tn.flags) or 'none'}; writes escalated to explicit approval")
    finally:
        _ui.reset(token)
        untrusted.end(scope)
    if not tainted:  # never learn (skills, memory) from a turn that handled untrusted content
        _spawn_review(r, agent, msgs[-1]["content"] if msgs else "", trace, "".join(answer))


async def run_bot(slug: str, text: str, asker: str = "jasper") -> str:
    """Headless turn for a delegated bot: tool loop if the bot has tools, else a plain completion. Depth-limited."""
    from api.routes.chat2 import _persona
    from core.eventbus import announce
    from core.llm.registry import get_router

    if _depth.get() >= MAX_DEPTH:
        return "error: delegation depth limit reached"
    if await orgchart.over_cap(slug):
        return f"error: {slug} reached its daily token cap"
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
            res = await r.complete(LLMRequest(**{"system": system, "messages": [{"role": "user", "content": text}], "tier": tier, "max_tokens": 900, **orgchart.llm_kwargs(slug)}))
            return res.text
    finally:
        _depth.reset(tok)
        announce(slug, "idle")
