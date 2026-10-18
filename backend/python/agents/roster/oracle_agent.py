"""
Oracle — Code Diagnosis Agent (IT Department, Stage 1).

Oracle reads a broken file, analyzes the error with an LLM, and proposes
an exact string-replacement fix. Darwin calls this before requesting approval.

Output contract:
  {
    "diagnosis":   "What is wrong and why",
    "file_path":   "relative/path/to/file.py",
    "old_string":  "exact substring to replace",
    "new_string":  "replacement code",
    "confidence":  0.0 – 1.0,
    "error":       null | "reason if diagnosis failed"
  }
"""

import re
import json
import structlog
from mcp.tools.filesystem_tool import read_codebase_file, FilesystemError

log = structlog.get_logger()


def _emit_reading(file_path: str, reason: str) -> None:
    try:
        from core.services.ide_bus import ide_bus
        ide_bus.emit({"agent": "Oracle", "action": "reading",
                      "file": file_path, "reason": reason[:120]})
    except Exception:
        pass

_DIAGNOSIS_PROMPT = """You are Oracle, an expert Python debugging AI embedded in the Sir Jazper OS IT Department.

You will receive an error message, a traceback, and the content of the file mentioned in the traceback.
Your job: diagnose the exact bug and propose a minimal, targeted fix.

RULES:
- old_string MUST be a verbatim substring of the FILE CONTENT shown below — copy it exactly, character for character
- old_string must be unique in the file (no repeated blocks)
- new_string replaces old_string — keep indentation consistent
- confidence: 0.9+ only if you are certain; 0.5–0.9 if plausible but not certain
- If you cannot propose a safe fix, set confidence to 0 and explain in diagnosis

Respond ONLY with valid JSON, no markdown fences, no extra text:
{
  "diagnosis":   "...",
  "file_path":   "...",
  "old_string":  "...",
  "new_string":  "...",
  "confidence":  0.0
}

ERROR:
{error_message}

TRACEBACK:
{traceback}

FILE ({file_path}):
{file_content}
"""


class OracleAgent:
    """Reads codebase files and diagnoses bugs using LLM analysis."""

    @classmethod
    def _extract_file_from_traceback(cls, traceback_str: str) -> str | None:
        """
        Find the most-likely broken file from a Python traceback.
        Skips site-packages and external libraries.
        """
        # Matches: File "path/to/file.py", line N
        matches = re.findall(r'File "([^"]+\.py)", line \d+', traceback_str)
        # Filter out external packages
        internal = [
            m for m in matches
            if "site-packages" not in m
            and "dist-packages" not in m
            and "Python3" not in m
            and "python3" not in m
        ]
        if not internal:
            return None
        # The last internal file in the traceback is usually the actual bug site
        return internal[-1]

    @classmethod
    def _abs_to_relative(cls, abs_path: str) -> str | None:
        """Convert absolute path to project-relative path for filesystem_tool."""
        import os
        # Normalise to forward slashes
        path = abs_path.replace("\\", "/")
        # Strip everything before backend/ or frontend/
        for marker in ("backend/python/app/", "frontend/src/", "backend/python/tests/"):
            idx = path.find(marker)
            if idx != -1:
                return path[idx:]
        return None

    @classmethod
    async def diagnose(cls, error_message: str, traceback_str: str) -> dict:
        """
        Main entry point called by Darwin.
        Returns the diagnosis dict (see module docstring).
        """
        from core.providers.ai_provider import ai_provider

        # ── 1. Find the broken file ───────────────────────────────────────────
        abs_path = cls._extract_file_from_traceback(traceback_str)
        if not abs_path:
            return {
                "diagnosis": "Could not identify a project file in the traceback.",
                "file_path": None, "old_string": None, "new_string": None,
                "confidence": 0.0, "error": "no_file_found",
            }

        rel_path = cls._abs_to_relative(abs_path)
        if not rel_path:
            return {
                "diagnosis": f"File {abs_path} is outside allowed project roots.",
                "file_path": abs_path, "old_string": None, "new_string": None,
                "confidence": 0.0, "error": "outside_allowed_roots",
            }

        # ── 2. Read the file ──────────────────────────────────────────────────
        try:
            content = read_codebase_file(rel_path)
            _emit_reading(rel_path, error_message[:120])
        except FilesystemError as e:
            return {
                "diagnosis": f"Could not read {rel_path}: {e}",
                "file_path": rel_path, "old_string": None, "new_string": None,
                "confidence": 0.0, "error": "read_failed",
            }

        # ── 3. Ask LLM to diagnose ────────────────────────────────────────────
        prompt = _DIAGNOSIS_PROMPT.format(
            error_message=error_message[:1000],
            traceback=traceback_str[:3000],
            file_path=rel_path,
            file_content=content[:6000],  # stay within context budget
        )

        try:
            # Use Claude for code diagnosis — far more reliable than Groq for exact
            # string extraction and JSON output with code context
            result = await ai_provider.claude_chat(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=1200,
            )
            raw = result.content.strip()
            # Strip possible markdown fences
            raw = re.sub(r"^```json\s*", "", raw)
            raw = re.sub(r"```$", "", raw).strip()
            diagnosis = json.loads(raw)
            diagnosis.setdefault("file_path", rel_path)
            diagnosis.setdefault("error", None)

            # Validate old_string is actually in the file
            if diagnosis.get("old_string") and diagnosis["old_string"] not in content:
                diagnosis["confidence"] = 0.0
                diagnosis["error"] = "old_string_not_found_in_file"
                log.warning("Oracle: old_string not in file", path=rel_path)

            log.info("Oracle: diagnosis complete",
                     path=rel_path, confidence=diagnosis.get("confidence", 0))
            try:
                from core.services.ide_bus import ide_bus
                ide_bus.emit({
                    "agent":      "Oracle",
                    "action":     "diagnosed",
                    "file":       rel_path,
                    "confidence": diagnosis.get("confidence", 0),
                    "summary":    diagnosis.get("diagnosis", "")[:120],
                })
            except Exception:
                pass
            return diagnosis

        except json.JSONDecodeError as e:
            log.error("Oracle: LLM returned invalid JSON", error=str(e))
            return {
                "diagnosis": "LLM returned invalid JSON — could not parse diagnosis.",
                "file_path": rel_path, "old_string": None, "new_string": None,
                "confidence": 0.0, "error": "json_parse_failed",
            }
        except Exception as e:
            log.error("Oracle: diagnosis failed", error=str(e))
            return {
                "diagnosis": f"Oracle error: {e}",
                "file_path": rel_path, "old_string": None, "new_string": None,
                "confidence": 0.0, "error": str(e),
            }
