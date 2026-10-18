"""
Orchestrator — Jazper's routing brain.

Routing strategy (fastest-first, no unnecessary LLM calls):

  1. Image present → always Lens
  2. Keyword pre-routing → instant, zero tokens, handles ~90% of cases
  3. High-confidence keyword match → skip LLM entirely
  4. Low-confidence / ambiguous → single fast LLM call to confirm
  5. No match → direct Jazper answer (no agents)
"""
from __future__ import annotations
import asyncio
import json
import structlog
from dataclasses import dataclass, field

from agents.roster.registry import agent_registry
from agents.roster.base_agent import AgentResult, AgentTrace
from core.providers.ai_provider import ai_provider
from core.config import settings

log = structlog.get_logger()

_ORCHESTRATOR_MODEL = settings.AI_MODEL
_FAST_ROUTING_MODEL = "llama-3.1-8b-instant"  # only used for ambiguous fallback


# ── Keyword routing tables ────────────────────────────────────────────────────
# Each entry: (agent_name, confidence, keyword_set)
# confidence: "high" → skip LLM, "low" → confirm with LLM

_SCOUT_HIGH = {
    "search", "look up", "find out", "google", "latest news", "current price",
    "what's happening", "whats happening", "who is", "recent", "right now",
    "today's", "todays", "breaking", "stock price", "weather", "forecast",
    "how much does", "what does it cost", "release notes", "changelog",
    "latest version", "current version", "new features", "announced",
    "launched", "what happened", "news about", "tell me about",
}
_SCOUT_LOW = {
    "latest", "current", "now", "recently", "this year", "2025", "2026",
    "version", "update", "new", "find", "search for",
}

_HERMES_HIGH = {
    "email", "emails", "inbox", "gmail", "unread", "mail",
    "send email", "send mail", "reply to", "forward this email",
    "draft email", "delete email", "archive email", "check inbox",
    "any emails", "new emails", "read my email", "mark as read",
    "star email", "trash email",
}
_HERMES_LOW = {
    "message", "messages", "received", "recruiter", "callback",
    "interview email", "job email", "reply", "respond",
}

_SAGE_HIGH = {
    "remember", "recall", "what did i tell you", "do you know my",
    "what's my", "whats my", "what is my", "my preference",
    "my notice period", "my salary", "i told you", "what do you know about me",
    "my profile", "about me", "my details", "store this", "save this",
    "don't forget", "keep in mind",
}
_SAGE_LOW = {
    "my", "i prefer", "i like", "i want", "i need", "remind me",
}

_LENS_HIGH = set()  # vision is triggered by image presence, not keywords

_ATLAS_HIGH = {
    "job applications", "how many applications", "application status",
    "interview pipeline", "job pipeline", "applied jobs", "job tracker",
    "cover letter", "write a cover letter", "generate cover letter", "draft cover letter",
    "job statistics", "application stats", "job hunting", "job search progress",
    "my applications", "companies i applied", "pending applications",
    "rejected applications", "interview callbacks", "shortlisted",
}
_ATLAS_LOW = {
    "job", "jobs", "apply", "application", "career", "hiring", "vacancy",
    "opportunity", "role", "position", "interview", "offer", "salary",
}

_PHANTOM_HIGH = {
    "scrape", "extract from", "read this page", "summarise this link",
    "summarize this link", "what does this url say", "open this link",
    "visit this url", "check this website", "read this article",
    "what's on this page", "whats on this page",
}
_PHANTOM_LOW = set()  # Phantom is triggered mainly by URL presence in message


def _has_url(message: str) -> bool:
    import re
    return bool(re.search(r'https?://', message))


def _keyword_route(message: str, has_image: bool) -> tuple[list[str], str, bool]:
    """
    Fast keyword-based routing. Returns (agents, reasoning, high_confidence).
    high_confidence=True means skip LLM entirely.
    """
    lower = message.lower()
    agents: list[str] = []
    reasoning_parts: list[str] = []
    high_conf_count = 0

    # Vision — always high confidence if image present
    if has_image:
        agents.append("Lens")
        reasoning_parts.append("image attached")
        high_conf_count += 1

    # Scout
    if any(kw in lower for kw in _SCOUT_HIGH):
        agents.append("Scout")
        reasoning_parts.append("live search needed")
        high_conf_count += 1
    elif any(kw in lower for kw in _SCOUT_LOW):
        agents.append("Scout")
        reasoning_parts.append("may need live data")

    # Hermes
    if any(kw in lower for kw in _HERMES_HIGH):
        agents.append("Hermes")
        reasoning_parts.append("email access needed")
        high_conf_count += 1
    elif any(kw in lower for kw in _HERMES_LOW) and not agents:
        # Only suggest Hermes on low-confidence if no other agent matched
        agents.append("Hermes")
        reasoning_parts.append("possible email context")

    # Sage
    if any(kw in lower for kw in _SAGE_HIGH):
        agents.append("Sage")
        reasoning_parts.append("memory recall needed")
        high_conf_count += 1
    elif any(kw in lower for kw in _SAGE_LOW) and "Sage" not in agents:
        # Only add Sage on low-confidence if no other non-lens agent matched
        # and the message doesn't look like a job-tracking query
        non_lens = [a for a in agents if a != "Lens"]
        _job_tracking_kw = {"application", "applied", "interview", "pipeline", "cover", "vacancy", "hiring"}
        if not non_lens and not any(kw in lower for kw in _job_tracking_kw):
            agents.append("Sage")
            reasoning_parts.append("possible memory context")

    # Atlas
    if any(kw in lower for kw in _ATLAS_HIGH):
        agents.append("Atlas")
        reasoning_parts.append("job data needed")
        high_conf_count += 1
    elif any(kw in lower for kw in _ATLAS_LOW) and "Atlas" not in agents:
        # Only add Atlas on low-confidence if no other meaningful agent matched
        # Sage already present means it's a memory query, not a jobs query
        non_lens = [a for a in agents if a != "Lens"]
        if not non_lens and not _has_url(message):
            agents.append("Atlas")
            reasoning_parts.append("possible job context")

    # Phantom — triggered by explicit scrape keywords OR by a URL in the message
    # Either path removes Atlas that snuck in via low-confidence (job keywords in scrape context)
    if any(kw in lower for kw in _PHANTOM_HIGH):
        agents = [a for a in agents if a != "Atlas"]
        agents.append("Phantom")
        reasoning_parts.append("web scraping needed")
        high_conf_count += 1
    elif _has_url(message) and "Phantom" not in agents:
        # URL detected — Phantom owns this; remove Atlas low-confidence if present
        agents = [a for a in agents if a != "Atlas"]
        agents.append("Phantom")
        reasoning_parts = [r for r in reasoning_parts if "possible job" not in r]
        reasoning_parts.append("URL detected — scraping")
        high_conf_count += 1

    # Deduplicate preserving order
    seen: set[str] = set()
    unique_agents = []
    for a in agents:
        if a not in seen:
            seen.add(a)
            unique_agents.append(a)

    high_confidence = high_conf_count >= len([a for a in unique_agents if a != "Lens"])
    reasoning = ", ".join(reasoning_parts) if reasoning_parts else "direct answer"
    return unique_agents[:3], reasoning, high_confidence


async def _llm_route(message: str, context: dict) -> tuple[list[str], str]:
    """
    Fallback LLM routing — only called for ambiguous messages.
    Uses the fast 8B model, not the main orchestrator model.
    """
    agent_registry._ensure_loaded()
    available = [a["name"] for a in agent_registry.descriptions() if a["name"] != "Lens"]
    names_str = ", ".join(available)

    system = (
        f"Classify which agents (if any) are needed: {names_str}.\n"
        "Reply ONLY with JSON: {\"agents\": [...], \"reasoning\": \"one sentence\"}\n"
        "Return empty agents [] for casual chat, math, code, opinions, explanations."
    )
    try:
        result = await ai_provider.chat(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": message},
            ],
            model=_FAST_ROUTING_MODEL,
            temperature=0.0,
            max_tokens=80,
        )
        raw = result.content.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        data = json.loads(raw)
        return data.get("agents", [])[:3], data.get("reasoning", "llm routing")
    except Exception as e:
        log.warning("LLM routing failed", error=str(e))
        return [], "routing error — direct answer"


@dataclass
class OrchestrationPlan:
    agents: list[str]
    reasoning: str
    routing_method: str = "keyword"   # "keyword" | "llm_fallback" | "vision"
    traces: list[AgentTrace] = field(default_factory=list)


async def orchestrate(
    message: str,
    context: dict,
    session_id: str,
    emit,
) -> tuple[str, OrchestrationPlan]:
    """
    Main entry point. Returns (assembled_response, plan).
    assembled_response is empty string when Jazper should answer directly.
    """
    agent_registry._ensure_loaded()
    has_image = bool(context.get("image"))

    # ── Step 1: Keyword routing (zero cost) ──────────────────────────────
    agents, reasoning, high_confidence = _keyword_route(message, has_image)

    if agents and high_confidence:
        routing_method = "keyword"
    elif agents and not high_confidence:
        # Low confidence — confirm with fast LLM
        llm_agents, llm_reasoning = await _llm_route(message, context)
        if llm_agents:
            agents = llm_agents
            reasoning = llm_reasoning
            routing_method = "llm_fallback"
        else:
            agents = []
            reasoning = "llm confirmed: direct answer"
            routing_method = "llm_fallback"
    else:
        routing_method = "direct"

    # Apply disabled-agent filter from context
    disabled = set(context.get("disabled_agents", []))
    agents = [a for a in agents if a not in disabled]

    plan = OrchestrationPlan(
        agents=agents,
        reasoning=reasoning,
        routing_method=routing_method,
    )

    await emit("ORCHESTRATOR_PLAN", {
        "agents": plan.agents,
        "reasoning": plan.reasoning,
        "method": plan.routing_method,
    })

    # ── Step 2: No agents — signal direct answer ──────────────────────────
    if not plan.agents:
        return "", plan

    # ── Step 3: Run agents — parallel when safe, sequential when dependent ───
    # Lens is always standalone (exclusive image context).
    # Hermes + Atlas are sequential (Atlas may consume email context).
    # All other combinations run in parallel via asyncio.gather().
    agent_overrides: dict = context.get("agent_overrides", {})

    _FORCE_SEQUENTIAL = {frozenset(["Hermes", "Atlas"])}

    def _use_parallel(agents: list[str]) -> bool:
        if len(agents) <= 1:
            return False
        if "Lens" in agents:
            return False
        if frozenset(agents[:2]) in _FORCE_SEQUENTIAL:
            return False
        return True

    async def _run_one(agent_name: str) -> AgentResult:
        agent = agent_registry.get(agent_name)
        if not agent:
            log.warning("Unknown agent in plan", agent=agent_name)
            dummy = AgentTrace(agent_name=agent_name, task=message, model="", system_prompt="", messages_sent=[])
            return AgentResult(content=f"[{agent_name} not found]", trace=dummy, success=False)
        overrides = agent_overrides.get(agent_name, {})
        original_model = agent.model
        if overrides.get("model"):
            agent.model = overrides["model"]
        try:
            return await agent.run(
                task=message,
                context={**context, "agent_overrides": overrides},
                session_id=session_id,
                emit=emit,
            )
        finally:
            agent.model = original_model

    results: list[AgentResult] = []

    if _use_parallel(plan.agents):
        parallel_results = await asyncio.gather(*[_run_one(n) for n in plan.agents])
        results = list(parallel_results)
        await emit("PARALLEL_DONE", {"agents": plan.agents, "count": len(results)})
    else:
        for agent_name in plan.agents:
            results.append(await _run_one(agent_name))

    for r in results:
        plan.traces.append(r.trace)

    # ── Step 4: Assemble ──────────────────────────────────────────────────
    assembled = await _assemble_response(message, context, results)
    return assembled, plan


async def _assemble_response(
    original_message: str,
    context: dict,  # noqa: ARG001 — used for system_prompt extraction
    results: list[AgentResult],
) -> str:
    """Synthesise agent outputs into a natural response."""
    # Single successful agent — return directly (no extra LLM call)
    if len(results) == 1 and results[0].success:
        return results[0].content

    # Multiple agents or partial failure — assemble with Jazper
    parts = "\n\n".join(
        f"[{r.trace.agent_name}]: {r.content}" for r in results
    )
    system_prompt = context.get("system_prompt") or ""
    system = (
        (system_prompt + "\n\n" if system_prompt else "") +
        "You received results from specialist agents. Synthesise into one natural, "
        "direct response. Do not mention agent names. No preamble."
    )
    result = await ai_provider.chat(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": f"User asked: {original_message}\n\nAgent results:\n{parts}"},
        ],
        model=_ORCHESTRATOR_MODEL,
        temperature=0.7,
        max_tokens=1024,
    )
    return result.content
