"""Incremental line diff for streamed model output (pattern: continue.dev core/diff/streamDiff.ts).

`HunkStreamer.feed(text)` takes the growing new text and returns hunks that have become *stable*: a change run followed by
at least `settle` unchanged lines can no longer be altered by later output. `finish()` flushes the rest.
Hunk lines are 0-based: old[old_start:old_start+old_len] is replaced by `new_lines`.
"""
import difflib
from dataclasses import dataclass, field


@dataclass
class Hunk:
    id: str
    old_start: int
    old_len: int
    new_lines: list[str]
    old_lines: list[str] = field(default_factory=list)

    def patch(self) -> str:
        return "".join(f"-{ln}\n" for ln in self.old_lines) + "".join(f"+{ln}\n" for ln in self.new_lines)


def diff_hunks(old: list[str], new: list[str]) -> list[Hunk]:
    sm = difflib.SequenceMatcher(a=old, b=new, autojunk=False)
    return [Hunk(f"h{n}", i1, i2 - i1, new[j1:j2], old[i1:i2])
            for n, (tag, i1, i2, j1, j2) in enumerate(op for op in sm.get_opcodes() if op[0] != "equal")]


def apply_hunks(old: list[str], hunks: list[Hunk]) -> list[str]:
    out, pos = [], 0
    for h in sorted(hunks, key=lambda x: x.old_start):
        out += old[pos:h.old_start] + h.new_lines
        pos = h.old_start + h.old_len
    return out + old[pos:]


class HunkStreamer:
    def __init__(self, old: list[str], settle: int = 3):
        self.old, self.settle, self.emitted = old, settle, 0

    def feed(self, text: str) -> list[Hunk]:
        lines = text.split("\n")[:-1]  # the last element is an incomplete line
        return self._stable(lines, final=False)

    def finish(self, text: str) -> list[Hunk]:
        return self._stable(text.split("\n") if text else [], final=True)

    def _stable(self, new: list[str], final: bool) -> list[Hunk]:
        hunks = diff_hunks(self.old, new)
        out = []
        for h in hunks[self.emitted:]:
            if not final:
                # stable only if `settle` new lines after this hunk's replacement already match the old text that follows
                tail_new = len(new) - (self._new_end(h, hunks))
                if tail_new < self.settle:
                    break
            out.append(h)
        self.emitted += len(out)
        return out

    def _new_end(self, h: Hunk, hunks: list[Hunk]) -> int:
        shift = sum(len(x.new_lines) - x.old_len for x in hunks if x.old_start < h.old_start)
        return h.old_start + shift + len(h.new_lines)
