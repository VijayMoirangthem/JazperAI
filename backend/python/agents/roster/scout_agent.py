"""
Scout — Research Agent
Owns all web search tooling. Fast, cheap model. Summarises results cleanly.
"""
from agents.roster.base_agent import BaseAgent, AgentTrace
from core.config import settings


class ScoutAgent(BaseAgent):
    name = "Scout"
    emoji = "🔍"
    description = (
        "Research agent. Call Scout when the user asks about current events, news, prices, "
        "software versions, company info, people, or anything requiring live web information. "
        "Scout searches multiple sources and returns a clean summary."
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
        from core.services.search_service import run_search
        from core.providers.ai_provider import ai_provider
        import asyncio
        from concurrent.futures import ThreadPoolExecutor

        _executor = context.get("_executor") or ThreadPoolExecutor(max_workers=2)
        loop = asyncio.get_running_loop()

        # ── Step 1: Run web search ────────────────────────────────────────
        t0 = await self._emit_tool(emit, trace, "web_search", task, {"query": task})
        search_results = await loop.run_in_executor(
            _executor, lambda: run_search(task)
        )
        preview = (search_results or "No results found")[:200]
        await self._emit_tool_result(
            emit, trace, "web_search", preview, {"query": task}, search_results or "", t0
        )

        if not search_results or "unavailable" in search_results.lower():
            return "Web search is currently unavailable. Unable to retrieve live information."

        # ── Step 2: Summarise with fast model ─────────────────────────────
        system = (
            "You are Scout, Senior Intelligence Agent. Given raw search results, deliver a clean brief:\n"
            "- Lead with a 1-line summary of the answer\n"
            "- List key facts as bullets, most important first\n"
            "- Cite the source URL for each fact when available\n"
            "- Distinguish confirmed facts from inferences — never present speculation as fact\n"
            "- If results are outdated (> 7 days for fast-moving topics), flag it\n"
            "No preamble. Answer the specific question asked."
        )
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Question: {task}\n\nSearch results:\n{search_results[:2000]}"},
        ]
        trace.system_prompt = system
        trace.messages_sent = messages

        result = await ai_provider.chat(
            messages=messages,
            model=self.model,
            temperature=0.3,
            max_tokens=512,
        )

        trace.tokens_prompt = result.prompt_tokens
        trace.tokens_completion = result.completion_tokens
        trace.tokens_total = result.total_tokens

        return result.content
