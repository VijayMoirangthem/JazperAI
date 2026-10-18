"""
Sage — Memory Agent
Stores and retrieves personal facts about the user. Fast small model.
"""
from agents.roster.base_agent import BaseAgent, AgentTrace


class SageAgent(BaseAgent):
    name = "Sage"
    emoji = "🧠"
    description = (
        "Memory agent. Call Sage to recall facts about the user (preferences, notice period, "
        "salary expectations, job preferences, personal details) or to store new facts. "
        "Also call Sage to retrieve relevant context from past conversations."
    )
    model = "llama-3.1-8b-instant"

    async def _run(
        self,
        task: str,
        context: dict,
        session_id: str,
        trace: AgentTrace,
        emit,
    ) -> str:
        from core.services.memory_service import memory_service
        from core.providers.ai_provider import ai_provider
        import asyncio
        from concurrent.futures import ThreadPoolExecutor

        _executor = context.get("_executor") or ThreadPoolExecutor(max_workers=2)
        loop = asyncio.get_running_loop()

        # ── Step 1: Fetch relevant memories ──────────────────────────────
        t0 = await self._emit_tool(emit, trace, "memory_search", task, {"query": task})

        core_memories = await memory_service.get_core_memories()

        long_term = ""
        try:
            from core.services.embedding_service import embed as local_embed, is_available
            if is_available():
                embedding = await loop.run_in_executor(_executor, lambda: local_embed(task))
                if embedding:
                    relevant = await memory_service.search_memories(task, top_k=6)
                    long_term = "\n".join(f"- {m}" for m in relevant) if relevant else ""
        except Exception:
            pass

        memory_text = ""
        if core_memories:
            memory_text += "Core facts:\n" + "\n".join(f"- {c}" for c in core_memories)
        if long_term:
            memory_text += ("\n\n" if memory_text else "") + "Relevant memories:\n" + long_term

        await self._emit_tool_result(
            emit, trace, "memory_search",
            f"{len(core_memories or [])} core + semantic search done",
            {"query": task}, memory_text, t0
        )

        if not memory_text:
            return "No relevant memories found for this query."

        # ── Step 2: Answer the query using retrieved memories ─────────────
        system = (
            "You are Sage, Head of Intelligence and Memory Keeper. "
            "You hold the user's stored facts, preferences, and past context.\n\n"
            "Answer the query directly using only the provided memory — no fabrication. "
            "If a fact is present, state it clearly and confidently. "
            "If the memory contains something partially relevant, surface it with a note on how it relates. "
            "If the memory genuinely does not contain the answer, say so in one sentence "
            "and suggest what the user could tell you to store for next time."
        )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Query: {task}\n\nMemory:\n{memory_text}"},
        ]
        trace.system_prompt = system
        trace.messages_sent = messages

        result = await ai_provider.chat(
            messages=messages,
            model=self.model,
            temperature=0.2,
            max_tokens=512,
        )

        trace.tokens_prompt = result.prompt_tokens
        trace.tokens_completion = result.completion_tokens
        trace.tokens_total = result.total_tokens

        return result.content
