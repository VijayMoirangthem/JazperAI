from dataclasses import dataclass, field
from typing import AsyncGenerator
import time


def _record_agent_run(
    agent_name: str,
    success: bool,
    duration_ms: int = 0,
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> None:
    """Fire-and-forget DB update for agent metrics. Never crashes the caller."""
    try:
        import psycopg2
        from app.core.config import settings as s
        conn = psycopg2.connect(
            host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
            user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD,
            dbname=s.POSTGRES_DB,
        )
        cur = conn.cursor()

        # 1. Update registry counters + health score
        if success:
            cur.execute(
                """UPDATE agent_registry
                   SET tasks_completed = tasks_completed + 1,
                       health_score    = GREATEST(0, LEAST(100,
                           ROUND((tasks_completed + 1)::float /
                                 NULLIF(tasks_completed + tasks_failed + 1, 0) * 100, 1)
                       )),
                       last_active     = NOW(),
                       updated_at      = NOW()
                   WHERE LOWER(name) = LOWER(%s)""",
                (agent_name,),
            )
        else:
            cur.execute(
                """UPDATE agent_registry
                   SET tasks_failed  = tasks_failed + 1,
                       health_score  = GREATEST(0, LEAST(100,
                           ROUND(tasks_completed::float /
                                 NULLIF(tasks_completed + tasks_failed + 1, 0) * 100, 1)
                       )),
                       last_active   = NOW(),
                       updated_at    = NOW()
                   WHERE LOWER(name) = LOWER(%s)""",
                (agent_name,),
            )

        # 2. Insert granular action record
        cur.execute(
            """INSERT INTO agent_actions
               (agent_id, action_type, outcome, duration_ms, input_tokens, output_tokens)
               SELECT agent_id, 'task_run', %s, %s, %s, %s
               FROM agent_registry WHERE LOWER(name) = LOWER(%s)""",
            (
                "success" if success else "failure",
                duration_ms, input_tokens, output_tokens,
                agent_name,
            ),
        )

        conn.commit()
        cur.close()
        conn.close()
    except Exception:
        pass  # metrics must never crash agent execution


@dataclass
class ToolCall:
    tool: str
    input: dict
    output: str
    duration_ms: int


@dataclass
class AgentTrace:
    """Full record of everything an agent did — sent to frontend for inspection."""
    agent_name: str
    task: str
    model: str
    system_prompt: str
    messages_sent: list[dict]
    tool_calls: list[ToolCall] = field(default_factory=list)
    result: str = ""
    tokens_prompt: int = 0
    tokens_completion: int = 0
    tokens_total: int = 0
    duration_ms: int = 0
    success: bool = True
    error: str | None = None


@dataclass
class AgentResult:
    content: str
    trace: AgentTrace
    success: bool = True
    error: str | None = None


class BaseAgent:
    """
    Contract all agents must fulfil.

    Subclasses implement `run()` and the parent handles:
    - SSE event emission (AGENT_START, AGENT_TOOL, AGENT_TOOL_RESULT, AGENT_DONE, AGENT_ERROR)
    - Trace recording
    - Error catching
    """

    name: str = "base"
    description: str = ""          # Jazper reads this to decide when to call this agent
    model: str = ""                # Overridden per agent
    emoji: str = "🤖"
    groq_only: bool = False        # if True, never fall back to local model (quality-critical agents)

    # ── Subclasses implement this ────────────────────────────────────────────
    async def _run(
        self,
        task: str,
        context: dict,
        session_id: str,
        trace: AgentTrace,
        emit,                      # async callable: emit(event_type, payload)
    ) -> str:
        raise NotImplementedError

    # ── Public entry point ───────────────────────────────────────────────────
    async def run(
        self,
        task: str,
        context: dict,
        session_id: str,
        emit,                      # async callable(event_type: str, payload: dict)
    ) -> AgentResult:
        from app.core.config import settings
        model = self.model or settings.AI_MODEL

        trace = AgentTrace(
            agent_name=self.name,
            task=task,
            model=model,
            system_prompt="",
            messages_sent=[],
        )

        start = time.monotonic()

        await emit("AGENT_START", {
            "name": self.name,
            "emoji": self.emoji,
            "task": task,
            "model": model,
        })

        try:
            result = await self._run(task, context, session_id, trace, emit)
            trace.result = result
            trace.duration_ms = int((time.monotonic() - start) * 1000)
            trace.success = True

            await emit("AGENT_DONE", {
                "name": self.name,
                "tokens_prompt": trace.tokens_prompt,
                "tokens_completion": trace.tokens_completion,
                "tokens_total": trace.tokens_total,
                "duration_ms": trace.duration_ms,
            })

            _record_agent_run(
                self.name, success=True,
                duration_ms=trace.duration_ms,
                input_tokens=trace.tokens_prompt,
                output_tokens=trace.tokens_completion,
            )
            return AgentResult(content=result, trace=trace, success=True)

        except Exception as e:
            trace.duration_ms = int((time.monotonic() - start) * 1000)
            trace.success = False
            trace.error = str(e)

            _record_agent_run(
                self.name, success=False,
                duration_ms=trace.duration_ms,
            )
            await emit("AGENT_ERROR", {"name": self.name, "error": str(e)})

            return AgentResult(
                content=f"[{self.name} failed: {e}]",
                trace=trace,
                success=False,
                error=str(e),
            )

    # ── Helper: emit a tool call event and record it in the trace ────────────
    async def _emit_tool(
        self,
        emit,
        trace: AgentTrace,
        tool_name: str,
        query: str,
        input_args: dict,
    ):
        await emit("AGENT_TOOL", {
            "agent": self.name,
            "tool": tool_name,
            "query": query,
        })
        return time.monotonic()

    async def _emit_tool_result(
        self,
        emit,
        trace: AgentTrace,
        tool_name: str,
        result_preview: str,
        input_args: dict,
        result_full: str,
        start_time: float,
    ):
        duration_ms = int((time.monotonic() - start_time) * 1000)
        tc = ToolCall(
            tool=tool_name,
            input=input_args,
            output=result_full,
            duration_ms=duration_ms,
        )
        trace.tool_calls.append(tc)
        await emit("AGENT_TOOL_RESULT", {
            "agent": self.name,
            "tool": tool_name,
            "preview": result_preview[:200],
            "duration_ms": duration_ms,
        })
