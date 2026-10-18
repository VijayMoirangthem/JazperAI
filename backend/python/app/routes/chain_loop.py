"""
Agentic Chain Loop — multi-step ReAct with approval gates.

Exported:
  run_chain_loop(...)     → async generator yielding SSE strings
  _approval_events        → dict[str, asyncio.Event]  (for approval endpoint in chat.py)
  _approval_decisions     → dict[str, dict]            (for approval endpoint in chat.py)

Classification is handled by _classify_intent() in chat.py, which runs in parallel
with the existing memory/profile lookups so it adds zero perceived latency.

SSE events emitted:
  [CHAIN_PLAN]{"steps": [...]}
  [CHAIN_STEP]{"step": N, "status": "thinking"|"running"|"done"|"error"|"approved"|"cancelled"|"timeout", "label": "...", "result": "..."}
  [APPROVAL_NEEDED]{"step": N, "tool": "...", "description": "...", "preview": "...", "args": {...}}
  [CHAIN_ERROR]{"message": "..."}
  [CHAIN_DONE]{"summary": "..."}
  {"__usage__": {"prompt": N, "completion": N, "total": N}}   ← always last, caught by _generate_inner
  text chunks
"""
from __future__ import annotations

import asyncio
import json
import re
import structlog
from concurrent.futures import ThreadPoolExecutor

from app.providers.ai_provider import ai_provider

log = structlog.get_logger()

# ── Approval gate state ────────────────────────────────────────────────────────
_approval_events: dict[str, asyncio.Event] = {}
_approval_decisions: dict[str, dict] = {}
APPROVAL_TIMEOUT_SEC = 300

# ── Destructive tools that require explicit user approval ─────────────────────
_DESTRUCTIVE_TOOLS = frozenset({
    "send_email", "trash_email", "archive_email", "bulk_email_action",
    "forward_email", "create_event", "run_script", "delete_event",
})

# ── Tool schemas available to the chain loop ─────────────────────────────────
_CHAIN_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_email",
            "description": "Search/fetch emails from Gmail. Pass a Gmail query or leave empty for inbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Gmail search query, e.g. 'from:recruiter', 'subject:interview'"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_email",
            "description": "Send an email. User approval required before sending.",
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {"type": "string"},
                    "subject": {"type": "string"},
                    "body": {"type": "string"},
                    "reply_to_id": {"type": "string", "description": "Thread ID for replies"},
                },
                "required": ["to", "subject", "body"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "trash_email",
            "description": "Move an email to trash. User approval required.",
            "parameters": {
                "type": "object",
                "properties": {"msg_id": {"type": "string"}},
                "required": ["msg_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for current information.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_note",
            "description": "Save a note or text to a file in storage.",
            "parameters": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "Filename (no path needed)"},
                    "content": {"type": "string", "description": "Text content to save"},
                },
                "required": ["filename", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_calendar",
            "description": (
                "Read Google Calendar events for a date or date range. "
                "Returns events with titles, times, locations, and attendees. "
                "Use to check what is scheduled or whether the user is free."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": (
                            "ISO date (YYYY-MM-DD) or relative: 'today', 'tomorrow', 'next week'. "
                            "Leave empty for today."
                        ),
                    },
                    "days": {
                        "type": "integer",
                        "description": "Number of days to look ahead from date. Default 1.",
                    },
                    "check_free": {
                        "type": "boolean",
                        "description": "If true, also returns whether the user is free during this window.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_event",
            "description": "Create a Google Calendar event. User approval is required before this executes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title":       {"type": "string"},
                    "start":       {"type": "string", "description": "ISO 8601 datetime e.g. 2026-07-22T10:00:00+05:30"},
                    "end":         {"type": "string", "description": "ISO 8601 datetime"},
                    "description": {"type": "string"},
                    "attendees":   {"type": "array", "items": {"type": "string"}, "description": "Email addresses"},
                    "location":    {"type": "string"},
                },
                "required": ["title", "start", "end"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delegate_to_agent",
            "description": (
                "Delegate a sub-task to a specialist agent in the COOS fleet. "
                "Use this when a step requires expertise from a specific agent — e.g. Scout for research, "
                "Hermes for email drafting, Atlas for planning, Sage for memory, Forge for code. "
                "Returns the agent's response as a string you can use in subsequent steps."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "agent": {
                        "type": "string",
                        "description": "Agent codename (e.g. 'scout', 'hermes', 'atlas', 'sage', 'forge', 'oracle')",
                    },
                    "task": {
                        "type": "string",
                        "description": "Clear, complete description of what the agent should do and what to return.",
                    },
                },
                "required": ["agent", "task"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "done",
            "description": "Signal that the task is fully complete. Call this when all steps are done.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "Summary of what was accomplished"},
                },
                "required": ["summary"],
            },
        },
    },
]


def _approval_description(tool_name: str, args: dict) -> str:
    if tool_name == "send_email":
        return f"Send email to **{args.get('to', '?')}**\nSubject: {args.get('subject', '?')}"
    if tool_name == "trash_email":
        return f"Move email (ID: {args.get('msg_id', '?')}) to trash"
    if tool_name == "archive_email":
        return f"Archive email (ID: {args.get('msg_id', '?')})"
    if tool_name == "bulk_email_action":
        return f"Bulk **{args.get('action', '?')}** all emails matching: {args.get('query', '?')}"
    if tool_name == "forward_email":
        return f"Forward email to **{args.get('to', '?')}**"
    if tool_name == "create_event":
        return f"Create calendar event: {args.get('summary', '?')}"
    if tool_name == "run_script":
        return f"Run script: `{args.get('command', '?')}`"
    return f"Execute `{tool_name}`"


async def _read_calendar(args: dict) -> str:
    """Fetch calendar events and optionally check free/busy."""
    import datetime as _dt

    def _fetch():
        from app.services.calendar_service import (
            CalendarNotAuthorized, get_today, get_week,
            check_free_busy, format_events_for_context,
        )
        date_str = args.get("date", "").lower().strip()
        days     = int(args.get("days", 1))
        do_free  = bool(args.get("check_free", False))

        # Resolve natural language dates
        today = _dt.date.today()
        if not date_str or date_str == "today":
            base = today
        elif date_str == "tomorrow":
            base = today + _dt.timedelta(days=1)
        elif "next week" in date_str:
            base = today + _dt.timedelta(days=(7 - today.weekday()))
        else:
            try:
                base = _dt.date.fromisoformat(date_str)
            except ValueError:
                base = today

        start_dt = _dt.datetime(base.year, base.month, base.day, 0, 0, 0)
        end_dt   = start_dt + _dt.timedelta(days=max(days, 1))
        start_iso = start_dt.isoformat() + "Z"
        end_iso   = end_dt.isoformat() + "Z"

        try:
            if days <= 1 and base == today:
                events = get_today()
            else:
                from app.services.calendar_service import get_events
                events = get_events(start_iso, end_iso, max_results=30)

            label = f"Calendar — {base.strftime('%A %d %b')}" + (
                f" to {(base + _dt.timedelta(days=days-1)).strftime('%d %b')}" if days > 1 else ""
            )
            text = format_events_for_context(events, label=label)

            if do_free:
                fb = check_free_busy(start_iso, end_iso)
                status = "✅ Free" if fb["free"] else f"⚠️ Busy ({len(fb['conflicts'])} conflict(s))"
                text += f"\n\nFree/busy: {status}"

            return text
        except CalendarNotAuthorized as exc:
            return f"Calendar not authorized: {exc}. Ask the user to re-authenticate at Settings → Google."

    return await asyncio.get_event_loop().run_in_executor(None, _fetch)


async def _create_calendar_event(args: dict) -> str:
    """Create a Google Calendar event (called after approval gate clears)."""
    def _create():
        from app.services.calendar_service import create_event, CalendarNotAuthorized
        try:
            event = create_event(
                title=args.get("title", "New Event"),
                start_iso=args.get("start", ""),
                end_iso=args.get("end", ""),
                description=args.get("description", ""),
                attendees=args.get("attendees") or None,
                location=args.get("location", ""),
            )
            lines = [f"✅ Event created: {event['title']}"]
            if event.get("start"):
                lines.append(f"   When: {event['start']}")
            if event.get("meet_link"):
                lines.append(f"   Meet: {event['meet_link']}")
            if event.get("attendees"):
                lines.append(f"   Guests: {', '.join(event['attendees'])}")
            return "\n".join(lines)
        except CalendarNotAuthorized as exc:
            return f"Calendar not authorized: {exc}"
        except Exception as exc:
            return f"Failed to create event: {exc}"

    return await asyncio.get_event_loop().run_in_executor(None, _create)


async def _delegate(agent_codename: str, task: str, model: str | None) -> str:
    """Run a one-shot non-streaming chat with a COOS fleet agent."""
    def _fetch_agent():
        try:
            import psycopg2
            from app.core.config import settings as s
            conn = psycopg2.connect(
                host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
                user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
            )
            with conn, conn.cursor() as cur:
                cur.execute(
                    "SELECT name, system_prompt, model FROM agent_registry WHERE codename=%s LIMIT 1",
                    (agent_codename,)
                )
                row = cur.fetchone()
                return row  # (name, system_prompt, model) or None
        except Exception:
            return None

    row = await asyncio.get_event_loop().run_in_executor(None, _fetch_agent)
    if not row:
        return f"Agent '{agent_codename}' not found in registry."

    agent_name, system_prompt, agent_model = row
    use_model = agent_model or model
    system = system_prompt or f"You are {agent_name}, a specialist AI agent. Complete the task and return a clear result."

    try:
        result = await ai_provider.chat(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": task},
            ],
            model=use_model,
            max_tokens=800,
            temperature=0.1,
            enable_thinking=False,
        )
        return f"[{agent_name}]: {result.content.strip()}"
    except Exception as exc:
        return f"Agent '{agent_codename}' call failed: {exc}"


async def _execute_tool(
    tool_name: str,
    args: dict,
    resolved_email: dict | None,
    session_id: str,
    executor: ThreadPoolExecutor,
    loop,
    model: str | None = None,
) -> str:
    """Dispatch a chain loop tool call. Returns the result string."""
    if tool_name == "read_calendar":
        return await _read_calendar(args)

    if tool_name == "create_event":
        return await _create_calendar_event(args)

    if tool_name == "delegate_to_agent":
        return await _delegate(
            agent_codename=args.get("agent", ""),
            task=args.get("task", ""),
            model=model,
        )

    if tool_name == "write_note":
        filename = re.sub(r"[^\w\-.]", "_", args.get("filename", "note"))
        if "." not in filename:
            filename += ".md"
        content_bytes = args.get("content", "").encode("utf-8")

        def _save():
            try:
                from app.services.storage import storage as _storage
                obj_name = _storage.upload("notes", filename, content_bytes, "text/markdown")
                return f"Note saved as {obj_name}"
            except Exception as exc:
                # Fallback: save locally
                import pathlib
                p = pathlib.Path("notes") / filename
                p.parent.mkdir(exist_ok=True)
                p.write_bytes(content_bytes)
                return f"Note saved locally as notes/{filename} ({exc} — MinIO fallback)"

        return await loop.run_in_executor(executor, _save)

    # All other tools: delegate to the existing dispatcher in chat.py
    # Lazy import to avoid circular dependency at module load time
    from app.routes.chat import _dispatch_tool_standalone
    return await _dispatch_tool_standalone(
        tool_name=tool_name,
        args=args,
        resolved_email=resolved_email,
        session_id=session_id,
        user_message="",
        loop=loop,
        executor=executor,
    )


async def run_chain_loop(
    message: str,
    session_id: str,
    history: list[dict],
    executor: ThreadPoolExecutor,
    loop,
    resolved_email: dict | None,
    user_profile: str | None,
    core_memories: list[str] | None,
    model: str | None,
):
    """
    Async generator for multi-step agentic chain execution.
    Yields SSE strings. Caller in _generate_inner collects text chunks into full_content.

    Guarantees:
    - Always yields {"__usage__": ...} as the final event so _generate_inner can
      update token counts regardless of how the loop exits.
    - Always cleans up _approval_events[session_id] in a finally block so there
      is no dict growth when sessions are abandoned mid-chain.
    """
    _usage: dict = {"prompt": 0, "completion": 0, "total": 0}

    def _add_usage(result) -> None:
        _usage["prompt"]     += getattr(result, "prompt_tokens", 0) or 0
        _usage["completion"] += getattr(result, "completion_tokens", 0) or 0
        _usage["total"]      += getattr(result, "total_tokens", 0) or 0

    try:
        # ── Step 0: Generate a plan ───────────────────────────────────────────
        plan_msgs = [
            {"role": "system", "content": (
                "You are a task planner. Given the user request, write a numbered list "
                "(max 8 steps) of the specific actions you will take to complete it. "
                "Be concrete. Output ONLY the numbered list — no preamble, no summary."
            )},
            *history[-4:],
            {"role": "user", "content": message},
        ]
        try:
            plan_result = await ai_provider.chat(
                messages=plan_msgs,
                model=model,
                max_tokens=400,
                temperature=0.05,
                enable_thinking=False,
            )
            _add_usage(plan_result)
            plan_text = plan_result.content.strip()
            steps = [
                re.sub(r"^\d+[\.\)]\s*", "", line).strip()
                for line in plan_text.splitlines()
                if re.match(r"^\d+[\.\)]\s", line.strip())
            ]
            if not steps:
                steps = [s.strip() for s in plan_text.split("\n") if s.strip()][:8] or ["Complete the task"]
        except Exception as exc:
            log.warning("chain_loop: plan step failed", error=str(exc))
            steps = ["Complete the requested task"]

        yield f"data: [CHAIN_PLAN]{json.dumps({'steps': steps})}\n\n"

        # ── Build execution context ───────────────────────────────────────────
        chain_system = (
            "You are Jazper, an AI assistant autonomously executing a multi-step task. "
            "Each turn: call exactly ONE tool OR call 'done' when the task is fully complete. "
            "Use exact data from tool results — never invent information. "
            "For destructive tools (send_email, trash_email) the user will be asked to approve — "
            "go ahead and call them; the approval gate is handled externally. "
            "Today is 2026.\n"
        )
        if user_profile:
            chain_system += f"\n{user_profile}\n"
        if core_memories:
            chain_system += "\n[Always remember]\n" + "\n".join(f"- {c}" for c in core_memories)

        exec_msgs: list[dict] = [
            {"role": "system", "content": chain_system},
            *history[-4:],
            {"role": "user", "content": message},
        ]

        MAX_STEPS = 12

        for step_num in range(1, MAX_STEPS + 1):
            yield f"data: [CHAIN_STEP]{json.dumps({'step': step_num, 'status': 'thinking'})}\n\n"

            # ── Ask LLM for next action ───────────────────────────────────────
            got_tool = False
            tool_event: dict = {}
            text_chunks: list[str] = []

            try:
                async for event in ai_provider.stream_with_tools(
                    messages=exec_msgs,
                    tools=_CHAIN_TOOLS,
                    model=model,
                    temperature=0.05,
                    max_tokens=800,
                    enable_thinking=False,
                ):
                    if isinstance(event, dict) and event.get("tool_call"):
                        got_tool = True
                        tool_event = event
                    elif isinstance(event, str) and event.startswith('{"__usage__":'):
                        try:
                            u = json.loads(event)["__usage__"]
                            _usage["prompt"]     += u.get("prompt", 0)
                            _usage["completion"] += u.get("completion", 0)
                            _usage["total"]      += u.get("total", 0)
                        except Exception:
                            pass
                    elif isinstance(event, str) and not event.startswith("{"):
                        text_chunks.append(event)
            except Exception as exc:
                log.error("chain_loop: LLM call failed", step=step_num, error=str(exc))
                yield f"data: [CHAIN_STEP]{json.dumps({'step': step_num, 'status': 'error', 'label': str(exc)})}\n\n"
                yield f"data: [CHAIN_ERROR]{json.dumps({'message': f'Step {step_num} failed: {exc}'})}\n\n"
                return

            if not got_tool:
                # Model returned text without calling a tool — treat as final answer
                final = "".join(text_chunks).strip()
                yield f"data: [CHAIN_DONE]{json.dumps({'summary': final[:200]})}\n\n"
                for chunk in text_chunks:
                    yield f"data: {chunk.replace(chr(10), chr(92) + 'n')}\n\n"
                return

            # ── Parse tool call ───────────────────────────────────────────────
            args = tool_event.get("arguments", {})
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception:
                    args = {}
            tool_name = tool_event.get("name", "done")
            tool_id = tool_event.get("id", f"chain_{step_num}")

            # ── done tool → wrap up ───────────────────────────────────────────
            if tool_name == "done":
                summary = args.get("summary", "Task complete.")
                yield f"data: [CHAIN_DONE]{json.dumps({'summary': summary})}\n\n"
                for word in summary.split(" "):
                    yield f"data: {word} \n\n"
                return

            # ── Approval gate for destructive actions ─────────────────────────
            if tool_name in _DESTRUCTIVE_TOOLS and session_id:
                description = _approval_description(tool_name, args)
                preview = args.get("body", "") if tool_name == "send_email" else None

                evt = asyncio.Event()
                _approval_events[session_id] = evt
                _approval_decisions.pop(session_id, None)

                yield f"data: [APPROVAL_NEEDED]{json.dumps({'step': step_num, 'tool': tool_name, 'description': description, 'preview': preview, 'args': args})}\n\n"

                try:
                    await asyncio.wait_for(evt.wait(), timeout=APPROVAL_TIMEOUT_SEC)
                except asyncio.TimeoutError:
                    yield f"data: [CHAIN_STEP]{json.dumps({'step': step_num, 'status': 'timeout', 'label': 'Approval timed out after 5 minutes'})}\n\n"
                    yield f"data: [CHAIN_ERROR]{json.dumps({'message': 'Approval timed out. The chain was stopped.'})}\n\n"
                    return

                decision = _approval_decisions.pop(session_id, {})

                if decision.get("action") != "approve":
                    yield f"data: [CHAIN_STEP]{json.dumps({'step': step_num, 'status': 'cancelled', 'label': f'{tool_name} cancelled by user'})}\n\n"
                    exec_msgs.append({
                        "role": "assistant", "content": None,
                        "tool_calls": [{"id": tool_id, "type": "function",
                                        "function": {"name": tool_name, "arguments": json.dumps(args)}}],
                    })
                    exec_msgs.append({
                        "role": "tool", "tool_call_id": tool_id,
                        "content": "The user cancelled this action. Continue with an alternative approach or call done().",
                    })
                    continue

                if decision.get("edited_args"):
                    args = decision["edited_args"]

                yield f"data: [CHAIN_STEP]{json.dumps({'step': step_num, 'status': 'approved', 'label': f'Approved: {tool_name}'})}\n\n"

            # ── Build human-readable step label ───────────────────────────────
            label = f"Running {tool_name}…"
            if tool_name == "read_email":
                q = args.get("query", "")
                label = f"Reading emails{': ' + q if q else ' (inbox)'}…"
            elif tool_name == "web_search":
                label = f"Searching: {args.get('query', '')}…"
            elif tool_name == "write_note":
                label = f"Saving note: {args.get('filename', 'note')}…"
            elif tool_name == "send_email":
                label = f"Sending email to {args.get('to', '?')}…"

            yield f"data: [CHAIN_STEP]{json.dumps({'step': step_num, 'status': 'running', 'label': label})}\n\n"

            # ── Execute tool ──────────────────────────────────────────────────
            try:
                tool_result = await _execute_tool(tool_name, args, resolved_email, session_id, executor, loop, model)
            except Exception as exc:
                tool_result = f"Tool error: {exc}"

            result_preview = tool_result[:300] if tool_result else ""
            yield f"data: [CHAIN_STEP]{json.dumps({'step': step_num, 'status': 'done', 'label': label, 'result': result_preview})}\n\n"

            # ── Append tool result to conversation ────────────────────────────
            exec_msgs.append({
                "role": "assistant", "content": None,
                "tool_calls": [{"id": tool_id, "type": "function",
                                "function": {"name": tool_name, "arguments": json.dumps(args)}}],
            })
            exec_msgs.append({"role": "tool", "tool_call_id": tool_id, "content": tool_result})

        # Reached MAX_STEPS — force a final synthesis answer
        exec_msgs.append({
            "role": "user",
            "content": "Summarize everything you've done and provide your final answer.",
        })
        final_chunks: list[str] = []
        try:
            async for chunk in ai_provider.stream(messages=exec_msgs, model=model, max_tokens=600, temperature=0.1):
                if isinstance(chunk, str) and chunk.startswith('{"__usage__":'):
                    try:
                        u = json.loads(chunk)["__usage__"]
                        _usage["prompt"]     += u.get("prompt", 0)
                        _usage["completion"] += u.get("completion", 0)
                        _usage["total"]      += u.get("total", 0)
                    except Exception:
                        pass
                elif isinstance(chunk, str) and not chunk.startswith("{"):
                    final_chunks.append(chunk)
                    yield f"data: {chunk.replace(chr(10), chr(92) + 'n')}\n\n"
        except Exception:
            pass
        yield f"data: [CHAIN_DONE]{json.dumps({'summary': ''.join(final_chunks)[:200]})}\n\n"

    finally:
        # Always clean up approval gate entries — prevents dict growth on crashes,
        # timeouts, or any other abnormal exit from the generator.
        _approval_events.pop(session_id, None)
        _approval_decisions.pop(session_id, None)
        # Always emit usage so _generate_inner can update the [META] token counts.
        yield f"data: {json.dumps({'__usage__': _usage})}\n\n"
