"""
Scroll — Spec Writer Agent (IT Department, Stage 2 Self-Create).

Scroll turns a user's feature description into a structured spec that
Darwin can hand to Forge for file creation.

Output contract:
  {
    "spec":           "Plain English description of what will be built",
    "files_to_create": [
      {"path": "relative/path/file.py", "description": "...", "content": "..."},
      ...
    ],
    "dependencies":   ["fastapi", "pydantic"],
    "risk":           "low | medium | high",
    "error":          null | "reason if spec failed"
  }
"""

import json
import re
import structlog

log = structlog.get_logger()

# Use a plain-text delimiter format to avoid JSON encoding of file content.
# Models reliably follow this; embedded newlines and quotes never break parsing.
_SPEC_PROMPT = """You are Scroll, a software architect AI embedded in the Sir Jazper OS IT Department.

The user wants to add a new feature to Sir Jazper OS.
Write a complete, buildable implementation with actual file content.

PLATFORM CONTEXT:
- Backend: FastAPI + Python 3.11, files in backend/python/app/
- Frontend: Next.js 16 (App Router) + TypeScript, files in frontend/src/
- DB: PostgreSQL + psycopg2
- AI: Use ai_provider.chat() from core.providers.ai_provider

ALLOWED WRITE PATHS:
  backend/python/app/  (routes, services, workers, agents)
  frontend/src/        (components, hooks, panels)
  backend/python/tests/

RULES:
- Generate complete, working file content — not stubs or placeholders
- Keep risk low: prefer adding new files over modifying existing ones
- Limit to 3 files maximum to keep scope manageable

Respond in EXACTLY this format (do not deviate):

SPEC: <one sentence describing what will be built>
RISK: low
DEPENDENCIES: []

FILE: <relative/path/to/file.ext>
DESCRIPTION: <one-line description>
<complete file content here>
ENDFILE

FILE: <relative/path/to/file2.ext>
DESCRIPTION: <one-line description>
<complete file content here>
ENDFILE

FEATURE REQUEST:
{description}
"""


def _parse_scroll_text(raw: str) -> dict:
    """
    Parse the custom delimiter format from Scroll's response into the spec dict.
    Returns a dict with spec, files_to_create, dependencies, risk.
    Raises ValueError if the format is unrecognizable.
    """
    # Extract header fields
    spec_match = re.search(r"^SPEC:\s*(.+)$", raw, re.MULTILINE)
    risk_match = re.search(r"^RISK:\s*(\S+)", raw, re.MULTILINE)
    deps_match = re.search(r"^DEPENDENCIES:\s*(\[.*?\])", raw, re.MULTILINE)

    spec_text = spec_match.group(1).strip() if spec_match else ""
    risk = risk_match.group(1).strip().lower() if risk_match else "medium"
    try:
        dependencies = json.loads(deps_match.group(1)) if deps_match else []
    except Exception:
        dependencies = []

    # Extract FILE ... ENDFILE blocks
    file_pattern = re.compile(
        r"FILE:\s*(\S+)\s*\nDESCRIPTION:\s*(.+?)\n(.*?)ENDFILE",
        re.DOTALL,
    )
    files = []
    for m in file_pattern.finditer(raw):
        path = m.group(1).strip()
        description = m.group(2).strip()
        content = m.group(3).rstrip("\n")
        # Strip markdown code fences the model sometimes wraps content in
        content = re.sub(r"^```[a-z]*\r?\n", "", content)
        content = re.sub(r"\n```\s*$", "", content)
        files.append({"path": path, "description": description, "content": content})

    if not files and not spec_text:
        raise ValueError("No FILE blocks and no SPEC found in response")

    return {
        "spec": spec_text,
        "files_to_create": files,
        "dependencies": dependencies,
        "risk": risk if risk in ("low", "medium", "high") else "medium",
        "error": None,
    }


class ScrollAgent:

    @classmethod
    async def write_spec(cls, description: str) -> dict:
        """
        Generate a structured spec + file contents for a new feature.
        """
        from core.providers.ai_provider import ai_provider

        prompt = _SPEC_PROMPT.format(description=description[:2000])

        try:
            result = await ai_provider.chat(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=3000,
            )
            raw = result.content.strip()

            # Strip any accidental markdown fences
            raw = re.sub(r"^```[a-z]*\s*", "", raw)
            raw = re.sub(r"```$", "", raw).strip()

            spec = _parse_scroll_text(raw)
            log.info("Scroll: spec written",
                     files=len(spec.get("files_to_create", [])),
                     risk=spec.get("risk"))
            return spec

        except ValueError as e:
            log.error("Scroll: format parse failed", error=str(e))
            return {
                "spec": "", "files_to_create": [], "dependencies": [],
                "risk": "high", "error": f"Format parse failed: {e}",
            }
        except Exception as e:
            log.error("Scroll: spec generation failed", error=str(e))
            return {
                "spec": "", "files_to_create": [], "dependencies": [],
                "risk": "high", "error": str(e),
            }
