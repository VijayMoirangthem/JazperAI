"""
Hermes — Email & Communications Agent
Owns all Gmail interactions. Uses higher-quality model for writing.
"""
from agents.roster.base_agent import BaseAgent, AgentTrace


class HermesAgent(BaseAgent):
    name = "Hermes"
    emoji = "📧"
    description = (
        "Email and communications agent. Call Hermes when the user wants to read, send, reply, "
        "forward, draft, archive, delete, star, or summarise emails. Also call Hermes to check "
        "for recruiter replies, interview callbacks, or any inbox-related questions."
    )
    model     = "llama-3.1-8b-instant"
    groq_only = True   # email quality requires Groq — never fall back to local 3B

    async def _run(
        self,
        task: str,
        context: dict,
        session_id: str,
        trace: AgentTrace,
        emit,
    ) -> str:
        from core.providers.ai_provider import ai_provider
        from api.routes.chat import (
            get_gmail_tools, _ALL_GMAIL_TOOLS, _dispatch_tool_standalone,
        )
        import asyncio, json
        from concurrent.futures import ThreadPoolExecutor

        _executor = context.get("_executor") or ThreadPoolExecutor(max_workers=2)
        loop = asyncio.get_running_loop()

        resolved_email = context.get("resolved_email")

        system = (
            "You are Hermes, Head of Communications. You have live access to the user's Gmail.\n\n"
            "For read/search requests: use the provided tools to fetch emails, then summarise clearly. "
            "Format each email as: Sender | Subject | Urgency | Required action.\n\n"
            "For draft/send requests: draft the email first and present it for review. "
            "NEVER send an email without the user explicitly approving the draft — "
            "if a send tool is available, call it ONLY after approval is confirmed.\n\n"
            "For reply/forward: read the original first, then draft.\n\n"
            "Never claim you cannot access email — you have the tools. "
            "Be concise. Professional but natural. Write in first person as the user."
        )

        gmail_tools = get_gmail_tools(task) or _ALL_GMAIL_TOOLS[:3]

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": task},
        ]
        trace.system_prompt = system
        trace.messages_sent = messages

        # ── ReAct loop (max 4 steps — email tasks rarely need more) ──────
        MAX_STEPS = 4
        for _ in range(MAX_STEPS):
            # stream_with_tools is an async generator — call directly, don't await
            chunks = []
            tool_sentinel = None
            async for item in ai_provider.stream_with_tools(
                messages=messages,
                tools=gmail_tools,
                model=self.model,
                temperature=0.3,
                max_tokens=1024,
                allow_local_fallback=False,
            ):
                if isinstance(item, dict) and item.get("tool_call"):
                    tool_sentinel = item
                elif isinstance(item, str):
                    chunks.append(item)

            if not tool_sentinel:
                # Model gave a final answer
                answer = "".join(chunks)
                trace.tokens_total = len(answer.split()) * 2  # rough estimate
                return answer

            # Execute the tool
            tool_name = tool_sentinel["name"]
            args = tool_sentinel.get("arguments", {})
            tool_id = tool_sentinel.get("id", "call_0")

            t0 = await self._emit_tool(emit, trace, tool_name, str(args), args)

            tool_result = await _dispatch_tool_standalone(
                tool_name=tool_name,
                args=args,
                resolved_email=resolved_email,
                session_id=session_id,
                user_message=task,
                loop=loop,
                executor=_executor,
            )

            await self._emit_tool_result(
                emit, trace, tool_name, tool_result[:200], args, tool_result, t0
            )

            # Append tool result to messages and continue loop
            messages.append({
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": tool_id,
                    "type": "function",
                    "function": {"name": tool_name, "arguments": json.dumps(args)},
                }],
            })
            messages.append({
                "role": "tool",
                "tool_call_id": tool_id,
                "content": tool_result,
            })

        return "Could not complete the email task within the allowed steps."
