"""LLM-backed implement step for the dev loop: for each target file the model returns the complete new file; on repair attempts it
also sees the previous test output. Files are written only inside the patch worktree (never the main checkout)."""
import re
from pathlib import Path

from core import finops
from core.llm.types import LLMRequest

SYSTEM = ("You edit exactly one source file to accomplish a task. Output ONLY the complete new content of the file: no explanations, "
          "no markdown fences. Keep everything unrelated to the task byte-for-byte identical.")
_FENCE = re.compile(r"^```[\w+-]*\n(.*?)\n```\s*$", re.S)


def strip_fences(text: str) -> str:
    m = _FENCE.match(text.strip())
    return (m.group(1) + "\n") if m else text


def make_implementer(task: str, files: list[str], router, agent: str = "forge"):
    async def implement(worktree: Path, attempt: int, feedback: str) -> None:
        for rel in files:
            p = (worktree / rel).resolve()
            if worktree.resolve() not in p.parents:
                raise ValueError(f"path escapes the worktree: {rel}")
            old = p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""
            prompt = f"Task: {task}\nFile: {rel}\n\n<<<FILE\n{old}\nFILE>>>"
            if feedback:
                prompt += f"\n\nThe previous attempt failed its tests. Test output:\n{feedback[-1500:]}\nFix the file."
            with finops.attribute(agent):
                res = await router.complete(LLMRequest(system=SYSTEM, messages=[{"role": "user", "content": prompt}], tier="standard", max_tokens=8000))
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(strip_fences(res.text), encoding="utf-8")
    return implement
