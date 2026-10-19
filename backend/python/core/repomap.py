"""Ranked repo map (pattern: aider repomap.py): which files/symbols matter most for a task, within a size budget.

Definitions and references are extracted per file (Python via `ast`, TS/JS via a lightweight scanner); a file references another when
it uses a name that the other defines; files are ranked with PageRank (networkx), personalised towards files in focus (for example
the ones named in a failing traceback). The map lists the top files with their definition signatures.
"""
import ast
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import networkx as nx

SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", "dist", "build", "storage", ".next"}
_TS_DEF = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+(\w+)|class\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\()", re.M)
_IDENT = re.compile(r"\b[A-Za-z_]\w{2,}\b")


@dataclass
class FileInfo:
    path: str
    defs: list[tuple[str, int, str]] = field(default_factory=list)  # (name, line, signature)
    refs: Counter = field(default_factory=Counter)


def _py(path: str, text: str) -> FileInfo:
    info = FileInfo(path)
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return info
    lines = text.splitlines()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            info.defs.append((node.name, node.lineno, lines[node.lineno - 1].strip()))
        elif isinstance(node, ast.Name):
            info.refs[node.id] += 1
        elif isinstance(node, ast.Attribute):
            info.refs[node.attr] += 1
        elif isinstance(node, ast.ImportFrom):
            for a in node.names:
                info.refs[a.name] += 1
    return info


def _ts(path: str, text: str) -> FileInfo:
    info = FileInfo(path)
    for m in _TS_DEF.finditer(text):
        name = next(g for g in m.groups() if g)
        line = text.count("\n", 0, m.start()) + 1
        info.defs.append((name, line, text.splitlines()[line - 1].strip()[:120]))
    info.refs.update(_IDENT.findall(text))
    return info


def scan(root: Path, max_files: int = 2000) -> dict[str, FileInfo]:
    out: dict[str, FileInfo] = {}
    for p in sorted(root.rglob("*")):
        if len(out) >= max_files:
            break
        if not p.is_file() or any(part in SKIP_DIRS for part in p.relative_to(root).parts):
            continue
        if p.suffix not in (".py", ".ts", ".tsx", ".js", ".jsx") or p.stat().st_size > 400_000:
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        rel = p.relative_to(root).as_posix()
        out[rel] = _py(rel, text) if p.suffix == ".py" else _ts(rel, text)
    return out


def rank(files: dict[str, FileInfo], focus: set[str] | None = None) -> list[tuple[str, float]]:
    definers: dict[str, set[str]] = defaultdict(set)
    for f in files.values():
        for name, _, _ in f.defs:
            definers[name].add(f.path)
    g = nx.DiGraph()
    g.add_nodes_from(files)
    for f in files.values():
        for name, count in f.refs.items():
            for target in definers.get(name, ()):
                if target != f.path:
                    w = (g[f.path][target]["weight"] if g.has_edge(f.path, target) else 0) + count ** 0.5
                    g.add_edge(f.path, target, weight=w)
    pers = {n: (100.0 if focus and n in focus else 1.0) for n in g}
    scores = nx.pagerank(g, weight="weight", personalization=pers) if g.number_of_edges() else {n: 1 / max(1, len(g)) for n in g}
    return sorted(scores.items(), key=lambda kv: -kv[1])


def render(files: dict[str, FileInfo], ranked: list[tuple[str, float]], budget_chars: int = 3000) -> str:
    out, used = [], 0
    for path, _ in ranked:
        f = files[path]
        if not f.defs:
            continue
        block = path + ":\n" + "\n".join(f"  {line:>4}: {sig}" for _, line, sig in sorted(f.defs, key=lambda d: d[1])[:20]) + "\n"
        if used + len(block) > budget_chars:
            break
        out.append(block)
        used += len(block)
    return "".join(out)


def repo_map(root: Path, focus: set[str] | None = None, budget_chars: int = 3000) -> str:
    files = scan(root)
    return render(files, rank(files, focus), budget_chars)
