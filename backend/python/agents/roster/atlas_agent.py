"""
Atlas — Jobs & Career Agent
Owns the full job hunting pipeline: search, track, cover letters, analytics.

What Atlas can do:
  - Query the job applications database (status, count, timelines)
  - Fetch the user's job profile (target roles, preferences, skills)
  - Generate tailored cover letters using AI
  - Search for live job market info via web search
  - Give career advice based on the user's profile + application history
"""
from __future__ import annotations
import json
import asyncio
from concurrent.futures import ThreadPoolExecutor

from agents.roster.base_agent import BaseAgent, AgentTrace
from core.providers.ai_provider import ai_provider


# ── DB helpers (sync, run in executor) ───────────────────────────────────────

def _get_applications(status: str | None = None, limit: int = 20) -> list[dict]:
    try:
        from core.services.linkedin_service import get_applications
        return get_applications(status=status, limit=limit)
    except Exception as e:
        return [{"error": str(e)}]


def _get_profile() -> dict:
    try:
        from core.services.linkedin_service import get_profile
        return get_profile()
    except Exception as e:
        return {"error": str(e)}


def _get_screening_answers() -> list[dict]:
    try:
        from core.services.linkedin_service import get_screening_answers
        return get_screening_answers()
    except Exception as e:
        return []


def _get_cover_letters() -> list[dict]:
    try:
        from core.services.linkedin_service import get_cover_letters
        return get_cover_letters()
    except Exception as e:
        return []


def _get_application_stats() -> dict:
    """Return aggregated application stats from the DB."""
    try:
        from memory.db.legacy_pg import _pg
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM job_applications")
                total = cur.fetchone()[0]
                cur.execute("SELECT status, COUNT(*) FROM job_applications GROUP BY status ORDER BY COUNT(*) DESC")
                by_status = {row[0]: row[1] for row in cur.fetchall()}
                cur.execute(
                    "SELECT company_name, job_title, status, applied_at FROM job_applications "
                    "ORDER BY applied_at DESC LIMIT 5"
                )
                recent = [
                    {"company": r[0], "title": r[1], "status": r[2], "applied_at": str(r[3])}
                    for r in cur.fetchall()
                ]
        return {"total": total, "by_status": by_status, "recent": recent}
    except Exception as e:
        return {"error": str(e), "total": 0, "by_status": {}, "recent": []}


# ── Intent detection ──────────────────────────────────────────────────────────

_STATS_KW = {
    "how many", "count", "total", "applied", "applications", "status",
    "interview", "rejection", "callback", "pipeline", "this week", "today",
    "pending", "accepted", "rejected", "shortlisted",
}
_COVER_LETTER_KW = {
    "cover letter", "write a cover letter", "generate cover letter",
    "draft cover", "tailor cover", "customise cover", "covering letter",
}
_PROFILE_KW = {
    "my profile", "my skills", "target role", "job preference", "my resume",
    "work mode", "remote preference", "salary expectation", "notice period",
    "experience", "what jobs am i looking for",
}
_SEARCH_KW = {
    "find jobs", "job openings", "hiring", "vacancies", "job market",
    "companies hiring", "job listings", "opportunities", "job search",
    "openings for", "looking for work", "best companies",
}


class AtlasAgent(BaseAgent):
    name = "Atlas"
    emoji = "📋"
    description = (
        "Jobs and career agent. Call Atlas when the user asks about their job applications, "
        "application statistics, interview pipeline, cover letters, job preferences, "
        "or wants to search for job opportunities. Also call Atlas for career advice."
    )
    model     = "llama-3.1-8b-instant"
    groq_only = True   # job/cover-letter quality requires Groq — never fall back to local 3B

    async def _run(
        self,
        task: str,
        context: dict,
        session_id: str,
        trace: AgentTrace,
        emit,
    ) -> str:
        loop = asyncio.get_running_loop()
        _executor = context.get("_executor") or ThreadPoolExecutor(max_workers=2)
        lower = task.lower()

        # ── Decide what Atlas needs to fetch ─────────────────────────────
        need_stats    = any(kw in lower for kw in _STATS_KW)
        need_cover    = any(kw in lower for kw in _COVER_LETTER_KW)
        need_profile  = any(kw in lower for kw in _PROFILE_KW) or need_cover
        need_search   = any(kw in lower for kw in _SEARCH_KW)

        # Default: if nothing specific matched, pull stats as general context
        if not any([need_stats, need_cover, need_profile, need_search]):
            need_stats = True

        context_parts: list[str] = []

        # ── Fetch application stats ───────────────────────────────────────
        if need_stats:
            t0 = await self._emit_tool(emit, trace, "job_applications_db", "fetch stats", {})
            stats = await loop.run_in_executor(_executor, _get_application_stats)
            if "error" not in stats:
                stats_text = (
                    f"Total applications: {stats['total']}\n"
                    f"By status: {json.dumps(stats['by_status'])}\n"
                    f"Recent: " + ", ".join(
                        f"{r['company']} ({r['title']}, {r['status']})"
                        for r in stats.get("recent", [])
                    )
                )
                context_parts.append(f"[Application Stats]\n{stats_text}")
            else:
                context_parts.append("[Application Stats]\nDatabase unavailable.")
            await self._emit_tool_result(
                emit, trace, "job_applications_db",
                f"{stats.get('total', 0)} total applications",
                {}, stats_text if "error" not in stats else stats["error"], t0
            )

        # ── Fetch user profile ────────────────────────────────────────────
        if need_profile:
            t0 = await self._emit_tool(emit, trace, "job_profile_db", "fetch profile", {})
            profile = await loop.run_in_executor(_executor, _get_profile)
            if profile and "error" not in profile:
                profile_text = (
                    f"Name: {profile.get('full_name', 'N/A')}\n"
                    f"Target roles: {', '.join(profile.get('target_roles') or ['Not set'])}\n"
                    f"Work modes: {', '.join(profile.get('work_modes') or ['Any'])}\n"
                    f"Locations: {', '.join(profile.get('locations') or ['Any'])}\n"
                    f"Salary: {profile.get('salary_min', '?')}–{profile.get('salary_max', '?')} LPA\n"
                    f"Experience: {profile.get('experience_years', '?')} years\n"
                    f"Skills: {', '.join(profile.get('skills') or [])}\n"
                    f"Resume: {'Set' if profile.get('resume_text') else 'Not uploaded'}"
                )
                context_parts.append(f"[User Job Profile]\n{profile_text}")
            else:
                context_parts.append("[User Job Profile]\nProfile not set up yet.")
            await self._emit_tool_result(
                emit, trace, "job_profile_db",
                "profile fetched" if profile and "error" not in profile else "no profile",
                {}, profile_text if profile and "error" not in profile else "", t0
            )

        # ── Live job search ───────────────────────────────────────────────
        if need_search:
            from core.services.search_service import run_search
            t0 = await self._emit_tool(emit, trace, "web_search", f"job search: {task[:60]}", {"query": task})
            search_results = await loop.run_in_executor(_executor, lambda: run_search(task))
            if search_results and "unavailable" not in search_results.lower():
                context_parts.append(f"[Live Job Search Results]\n{search_results[:1500]}")
            await self._emit_tool_result(
                emit, trace, "web_search",
                (search_results or "No results")[:200],
                {"query": task}, search_results or "", t0
            )

        # ── Cover letter generation ───────────────────────────────────────
        if need_cover:
            # Also fetch existing cover letters for style reference
            t0 = await self._emit_tool(emit, trace, "cover_letters_db", "fetch templates", {})
            existing = await loop.run_in_executor(_executor, _get_cover_letters)
            if existing:
                context_parts.append(
                    f"[Existing Cover Letter Style]\n{existing[0].get('content', '')[:500]}"
                )
            await self._emit_tool_result(
                emit, trace, "cover_letters_db",
                f"{len(existing)} templates found", {}, "", t0
            )

        # ── Generate answer ───────────────────────────────────────────────
        system = (
            "You are Atlas, Head of Operations. You manage the user's job pipeline and career strategy.\n\n"
            "For application stats: present numbers clearly — total, by status, recent activity. "
            "Flag patterns (e.g. high rejection rate, no interview callbacks) and suggest concrete next steps.\n\n"
            "For cover letters: write the full letter, not a template. "
            "Match the job requirements to the user's actual skills. "
            "Write in first person, professional but natural — not corporate. "
            "Keep under 300 words unless the role demands more.\n\n"
            "For career advice: be specific and actionable. "
            "Base advice on the user's actual profile data, not generic tips.\n\n"
            "Never fabricate application counts or status — use only the data provided below. "
            "If data is missing, say what you need and where the user can add it."
        )

        user_content = task
        if context_parts:
            user_content += "\n\n" + "\n\n".join(context_parts)

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ]
        trace.system_prompt = system
        trace.messages_sent = [{"role": "system", "content": system}, {"role": "user", "content": task}]

        result = await ai_provider.chat(
            messages=messages,
            model=self.model,
            temperature=0.5,
            max_tokens=context.get("agent_overrides", {}).get("Atlas", {}).get("maxTokens") or 1024,
            allow_local_fallback=False,
        )

        trace.tokens_prompt = result.prompt_tokens
        trace.tokens_completion = result.completion_tokens
        trace.tokens_total = result.total_tokens

        return result.content
