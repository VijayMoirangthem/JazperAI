"""Small helpers to describe a unified diff for people (a phone screen, an approval card)."""
from __future__ import annotations

import re

from core.logfile import redact

_FILE = re.compile(r"^diff --git a/(.+?) b/(.+)$")


def diff_stats(diff: str) -> dict:
    """{files:[{path, added, removed}], added, removed} from a unified diff (git diff output)."""
    files: list[dict] = []
    cur: dict | None = None
    for line in (diff or "").splitlines():
        m = _FILE.match(line)
        if m:
            cur = {"path": m.group(2), "added": 0, "removed": 0}
            files.append(cur)
        elif cur is not None and line.startswith("+") and not line.startswith("+++"):
            cur["added"] += 1
        elif cur is not None and line.startswith("-") and not line.startswith("---"):
            cur["removed"] += 1
    return {"files": files, "added": sum(f["added"] for f in files), "removed": sum(f["removed"] for f in files)}


def stats_line(stats: dict, max_files: int = 4) -> str:
    """'3 files changed (+42 -7): app.py, tests/test_app.py, ...' for the approval card."""
    n = len(stats["files"])
    if n == 0:
        return "no file changes"
    names = ", ".join(f["path"] for f in stats["files"][:max_files]) + (", ..." if n > max_files else "")
    return f"{n} file{'s' if n != 1 else ''} changed (+{stats['added']} -{stats['removed']}): {names}"


def safe_diff(diff: str, limit: int = 12000) -> tuple[str, bool]:
    """The diff text for display: secrets redacted, cut at `limit` characters on a line boundary. Returns (text, was_cut)."""
    text = redact(diff or "")
    if len(text) <= limit:
        return text, False
    cut = text[:limit]
    cut = cut[: cut.rfind("\n")] if "\n" in cut else cut
    return cut, True
