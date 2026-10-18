"""
Scribe — Test Generation Agent (IT Department, Phase 19).

When Forge creates a new .py file (route or agent), Scribe generates
a pytest test file and saves it to backend/python/tests/.

If the generated test already exists, Scribe skips silently.
"""

import os
import structlog
from core.providers.ai_provider import ai_provider

log = structlog.get_logger()

# Base directory for the backend/python package
_BASE_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))


class ScribeAgent:

    @classmethod
    async def generate_tests(cls, file_path: str, content: str) -> dict:
        """
        Generate a pytest test file for the given Python source file.

        Args:
            file_path: Relative path within backend/python, e.g. "app/routes/tasks.py"
            content:   Source code content of the file.

        Returns:
            {"ok": True/False, "test_path": str, "skipped": bool, "error": str|None}
        """
        # Normalise separators
        fp = file_path.replace("\\", "/")

        # Only handle .py files
        if not fp.endswith(".py"):
            return {"ok": True, "test_path": "", "skipped": True, "error": None}

        # Don't generate tests for files already inside tests/
        if fp.startswith("tests/") or "/tests/" in fp:
            return {"ok": True, "test_path": fp, "skipped": True, "error": None}

        # Derive test_path
        test_path: str | None = None
        for prefix in ("api/routes/", "agents/roster/"):
            if fp.startswith(prefix):
                basename = fp[len(prefix):]          # e.g. "tasks.py" or "forge_agent.py"
                test_path = f"tests/test_{basename}" # e.g. "tests/test_tasks.py"
                break

        if test_path is None:
            # For any other .py file strip down to just the filename
            basename = os.path.basename(fp)
            test_path = f"tests/test_{basename}"

        # Skip if test already exists
        full_test_path = os.path.join(_BASE_DIR, test_path.replace("/", os.sep))
        if os.path.exists(full_test_path):
            log.info("Scribe: test already exists, skipping", test_path=test_path)
            return {"ok": True, "test_path": test_path, "skipped": True, "error": None}

        try:
            prompt = (
                "You are writing pytest tests for the following Python file. "
                "Generate focused, realistic tests that test the happy path and one error path "
                "for each route/function. Use pytest and httpx.AsyncClient (for FastAPI routes) "
                "or direct class calls (for agents). "
                "Do NOT import from packages that don't exist. "
                "Return ONLY the Python test file content, no markdown, no explanation.\n\n"
                f"File: {file_path}\n\n{content}"
            )

            result = await ai_provider.chat(
                messages=[{"role": "user", "content": prompt}],
                model="llama-3.3-70b-versatile",
                max_tokens=2000,
                temperature=0.3,
            )

            code = result.content or ""

            # Strip markdown fences if present
            if code.startswith("```python"):
                code = code[len("```python"):].lstrip("\n")
            if code.startswith("```"):
                code = code[3:].lstrip("\n")
            if code.rstrip().endswith("```"):
                code = code.rstrip()[:-3].rstrip()

            # Ensure tests/ directory exists
            tests_dir = os.path.join(_BASE_DIR, "tests")
            os.makedirs(tests_dir, exist_ok=True)

            with open(full_test_path, "w", encoding="utf-8") as f:
                f.write(code)

            log.info("Scribe: test file written", test_path=test_path)
            return {"ok": True, "test_path": test_path, "skipped": False, "error": None}

        except Exception as e:
            log.error("Scribe: test generation failed", file_path=file_path, error=str(e))
            return {"ok": False, "test_path": test_path, "skipped": False, "error": str(e)}
