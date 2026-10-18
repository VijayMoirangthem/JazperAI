"""
Verdict — Code Auditor Agent (IT Department, Phase 6 QA).

Verdict reviews every code change before Forge applies it. It reads the full
file, examines the proposed diff, and flags bugs, unsafe operations, import
problems, and convention violations.

Darwin inserts Verdict between the approval gate and Forge:
  Oracle → Approval → [Verdict] → Forge → Shield

Output contract for review_diff / review_new_file:
  {
    "safe":        bool,
    "issues":      [{"severity": "CRITICAL|HIGH|MEDIUM|LOW",
                     "line_hint": "...",
                     "description": "..."}],
    "summary":     "...",
    "error":       null | "reason if audit itself failed"
  }

Severity rules (enforced by Darwin):
  CRITICAL → block deployment immediately, mark ticket needs_human
  HIGH     → log warning, proceed (user already approved)
  MEDIUM   → log info, proceed
  LOW      → proceed silently
"""

import re
import json
import structlog
from mcp.tools.filesystem_tool import read_codebase_file, FilesystemError

log = structlog.get_logger()

_DIFF_REVIEW_PROMPT = """You are Verdict, a ruthless Code Auditor AI embedded in the Sir Jazper OS IT Department.

A code change has been proposed. Your job: audit it for bugs, unsafe operations, import errors,
syntax problems, and violations of the codebase conventions listed below.

CONVENTIONS:
- All agents inherit BaseAgent or use classmethods — no standalone functions as agents
- DB access uses psycopg2 directly (no ORM) with try/except and conn.close() in finally
- Logging uses structlog (log.info / log.warning / log.error) — never print()
- old_string must appear verbatim in the file — if it does not, that is a CRITICAL issue
- No hardcoded secrets, passwords, or API keys

SEVERITY LEVELS:
- CRITICAL: syntax error, missing import, old_string not found, hardcoded secret, infinite loop
- HIGH:     logic bug likely to cause wrong behaviour, unclosed resource, wrong return type
- MEDIUM:   convention violation, unnecessary complexity, misleading variable name
- LOW:      style nit, unused variable, redundant comment

Respond ONLY with valid JSON, no markdown fences, no extra text:
{{
  "safe": true,
  "issues": [],
  "summary": "Diff looks correct. No issues found."
}}

Or if issues exist:
{{
  "safe": false,
  "issues": [
    {{"severity": "CRITICAL", "line_hint": "line 42 — missing import", "description": "json is used but never imported in the new_string"}}
  ],
  "summary": "One CRITICAL issue blocks deployment."
}}

FILE: {file_path}
{file_content}

--- PROPOSED DIFF ---
REMOVE (old_string):
{old_string}

ADD (new_string):
{new_string}

DIAGNOSIS CONTEXT:
{diagnosis_context}
"""

_NEW_FILE_REVIEW_PROMPT = """You are Verdict, a ruthless Code Auditor AI embedded in the Sir Jazper OS IT Department.

A brand-new file is about to be created by the Self-Create workflow. Audit it before it goes to disk.

CONVENTIONS:
- All agents inherit BaseAgent or use classmethods — no standalone functions as agents
- DB access uses psycopg2 directly (no ORM)
- Logging uses structlog — never print()
- No hardcoded secrets, passwords, or API keys

SEVERITY LEVELS:
- CRITICAL: syntax error, missing import, hardcoded secret, would crash on import
- HIGH:     logic bug, unclosed resource, wrong return type
- MEDIUM:   convention violation, missing docstring for complex code
- LOW:      style nit

Respond ONLY with valid JSON, no markdown fences, no extra text:
{{
  "safe": true,
  "issues": [],
  "summary": "New file looks correct. Ready to create."
}}

FILE TO CREATE: {file_path}

SPEC CONTEXT:
{spec_context}

FILE CONTENT:
{file_content}
"""


class VerdictAgent:
    """Reviews proposed code changes before Forge applies them."""

    @classmethod
    async def review_diff(
        cls,
        file_path: str,
        old_string: str,
        new_string: str,
        diagnosis_context: str = "",
    ) -> dict:
        """
        Audit a string-replacement diff against the full file.
        Called by Darwin after approval, before Forge.apply_fix().
        """
        from core.providers.ai_provider import ai_provider

        # ── Read the current file ─────────────────────────────────────────────
        try:
            content = read_codebase_file(file_path)
        except FilesystemError as e:
            log.error("Verdict: cannot read file for audit", path=file_path, error=str(e))
            return cls._error_result(f"Cannot read {file_path}: {e}")

        # ── Quick pre-check: old_string must be in file ───────────────────────
        if old_string and old_string not in content:
            log.warning("Verdict: old_string not in file — CRITICAL block", path=file_path)
            return {
                "safe": False,
                "issues": [{
                    "severity": "CRITICAL",
                    "line_hint": "old_string",
                    "description": "old_string does not appear verbatim in the current file. The fix cannot be applied safely.",
                }],
                "summary": "CRITICAL: old_string mismatch — deployment blocked.",
                "error": None,
            }

        prompt = _DIFF_REVIEW_PROMPT.format(
            file_path=file_path,
            file_content=content[:6000],
            old_string=old_string[:1500],
            new_string=new_string[:1500],
            diagnosis_context=diagnosis_context[:500],
        )

        return await cls._call_llm(prompt, context=f"diff:{file_path}")

    @classmethod
    async def review_new_file(
        cls,
        file_path: str,
        content: str,
        spec_context: str = "",
    ) -> dict:
        """
        Audit a brand-new file before Forge.create_file() is called.
        Called by Darwin in the self-create workflow.
        """
        prompt = _NEW_FILE_REVIEW_PROMPT.format(
            file_path=file_path,
            spec_context=spec_context[:500],
            file_content=content[:6000],
        )
        return await cls._call_llm(prompt, context=f"new:{file_path}")

    # ── Internal helpers ──────────────────────────────────────────────────────

    @classmethod
    async def _call_llm(cls, prompt: str, context: str = "") -> dict:
        from core.providers.ai_provider import ai_provider
        try:
            result = await ai_provider.chat(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=600,
            )
            raw = result.content.strip()
            raw = re.sub(r"^```json\s*", "", raw)
            raw = re.sub(r"```$", "", raw).strip()
            parsed = json.loads(raw)
            parsed.setdefault("error", None)
            parsed.setdefault("issues", [])
            parsed.setdefault("summary", "")

            critical_count = sum(1 for i in parsed["issues"] if i.get("severity") == "CRITICAL")
            high_count     = sum(1 for i in parsed["issues"] if i.get("severity") == "HIGH")

            log.info(
                "Verdict: audit complete",
                context=context,
                safe=parsed.get("safe"),
                critical=critical_count,
                high=high_count,
            )
            return parsed

        except json.JSONDecodeError as e:
            log.error("Verdict: LLM returned invalid JSON", error=str(e))
            return cls._error_result("LLM returned invalid JSON")
        except Exception as e:
            log.error("Verdict: audit failed", error=str(e))
            return cls._error_result(str(e))

    @classmethod
    def _error_result(cls, reason: str) -> dict:
        """Return a safe=True result when Verdict itself fails (fail-open for LLM errors)."""
        return {
            "safe": True,
            "issues": [],
            "summary": f"Verdict audit error (proceeding): {reason}",
            "error": reason,
        }
