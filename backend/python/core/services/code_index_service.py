"""Phase 2 — Codebase Context & Code Understanding (RAG).

Walks a workspace, chunks source files by symbol (Python via stdlib `ast`,
JS/TS/TSX via regex heuristics, generic sliding-window fallback for everything
else), embeds each chunk with the existing local embedding service, and stores
them in `code_chunks` (pgvector) for semantic retrieval. Also provides a plain
keyword grep across the same file set (no `rg` binary dependency required).
"""
from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from pathlib import Path

import psycopg2
import psycopg2.extras
import structlog

from core.config import settings
from core.services import embedding_service

log = structlog.get_logger()

_SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".next", ".venv", "venv",
    "dist", "build", ".mypy_cache", ".pytest_cache", ".ruff_cache",
    "uploads", ".turbo", ".cache",
}
_BLOCKED_FILES = {".env", ".env.local", ".env.production", ".env.development"}

_CODE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".md",
    ".css", ".sql", ".yml", ".yaml",
}

_MAX_FILE_BYTES = 400_000
_WINDOW_LINES = 60
_WINDOW_OVERLAP = 10

_JS_SYMBOL_RE = re.compile(
    r"^\s*(?:export\s+)?(?:default\s+)?"
    r"(?:async\s+)?function\s+(?P<fn>\w+)"
    r"|^\s*(?:export\s+)?class\s+(?P<cls>\w+)"
    r"|^\s*(?:export\s+)?(?:const|let)\s+(?P<constfn>\w+)\s*=\s*(?:async\s*)?\("
)


def _pg():
    return psycopg2.connect(
        host=settings.POSTGRES_HOST, port=settings.POSTGRES_PORT,
        user=settings.POSTGRES_USER, password=settings.POSTGRES_PASSWORD,
        dbname=settings.POSTGRES_DB,
    )


@dataclass
class Chunk:
    file_path: str
    symbol_name: str
    symbol_type: str
    start_line: int
    end_line: int
    content: str


def _iter_files(root: Path):
    for path in root.rglob("*"):
        if path.is_dir():
            continue
        if path.suffix.lower() not in _CODE_EXTENSIONS:
            continue
        if path.name in _BLOCKED_FILES:
            continue
        if any(part in _SKIP_DIRS for part in path.relative_to(root).parts):
            continue
        try:
            if path.stat().st_size > _MAX_FILE_BYTES:
                continue
        except OSError:
            continue
        yield path


def _chunk_python(text: str) -> list[tuple[int, int, str, str]]:
    """Return (start_line, end_line, symbol_name, symbol_type) for top-level defs/classes."""
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return []
    out = []
    for node in ast.iter_child_nodes(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            end = getattr(node, "end_lineno", node.lineno)
            kind = "class" if isinstance(node, ast.ClassDef) else "function"
            out.append((node.lineno, end, node.name, kind))
    return out


def _chunk_js(lines: list[str]) -> list[tuple[int, int, str, str]]:
    """Heuristic: mark a symbol start at each match; end = next symbol start - 1 (or EOF)."""
    starts = []
    for i, line in enumerate(lines, start=1):
        m = _JS_SYMBOL_RE.match(line)
        if m:
            name = m.group("fn") or m.group("cls") or m.group("constfn")
            kind = "class" if m.group("cls") else "function"
            starts.append((i, name, kind))
    out = []
    for idx, (start, name, kind) in enumerate(starts):
        end = starts[idx + 1][0] - 1 if idx + 1 < len(starts) else len(lines)
        out.append((start, end, name, kind))
    return out


def _sliding_windows(lines: list[str]) -> list[tuple[int, int, str, str]]:
    out = []
    n = len(lines)
    if n == 0:
        return out
    step = max(_WINDOW_LINES - _WINDOW_OVERLAP, 1)
    start = 1
    while start <= n:
        end = min(start + _WINDOW_LINES - 1, n)
        out.append((start, end, "", "block"))
        if end >= n:
            break
        start += step
    return out


def _chunk_file(path: Path, rel: str) -> list[Chunk]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return []
    if not text.strip():
        return []
    lines = text.splitlines()

    if path.suffix == ".py":
        spans = _chunk_python(text)
    elif path.suffix in {".ts", ".tsx", ".js", ".jsx"}:
        spans = _chunk_js(lines)
    else:
        spans = []

    if not spans:
        spans = _sliding_windows(lines)

    chunks = []
    for start, end, name, kind in spans:
        body = "\n".join(lines[start - 1:end])
        if not body.strip():
            continue
        chunks.append(Chunk(rel, name, kind, start, end, body[:8000]))
    return chunks


def build_index(workspace_root: Path) -> dict:
    """Re-index the given workspace: delete old chunks, chunk + embed + insert new ones."""
    root_key = str(workspace_root.resolve())
    files_scanned = 0
    chunks_written = 0
    embed_failures = 0

    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM code_chunks WHERE workspace_root = %s", (root_key,))
        conn.commit()

        rows = []
        for path in _iter_files(workspace_root):
            rel = path.relative_to(workspace_root).as_posix()
            files_scanned += 1
            for chunk in _chunk_file(path, rel):
                vec = embedding_service.embed(chunk.content)
                if vec is None:
                    embed_failures += 1
                    continue
                vec_literal = "[" + ",".join(str(x) for x in vec) + "]"
                rows.append((
                    root_key, chunk.file_path, chunk.symbol_name, chunk.symbol_type,
                    chunk.start_line, chunk.end_line, chunk.content, vec_literal,
                ))

        if rows:
            psycopg2.extras.execute_batch(
                cur,
                """
                INSERT INTO code_chunks
                    (workspace_root, file_path, symbol_name, symbol_type,
                     start_line, end_line, content, embedding)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s::vector)
                """,
                rows,
                page_size=200,
            )
            conn.commit()
        chunks_written = len(rows)
    finally:
        conn.close()

    log.info("code_index.build", workspace=root_key, files=files_scanned, chunks=chunks_written)
    return {
        "workspace_root": root_key,
        "files_scanned": files_scanned,
        "chunks_written": chunks_written,
        "embed_failures": embed_failures,
    }


def index_status(workspace_root: Path) -> dict:
    root_key = str(workspace_root.resolve())
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*), MAX(updated_at) FROM code_chunks WHERE workspace_root = %s",
            (root_key,),
        )
        count, last_updated = cur.fetchone()
    finally:
        conn.close()
    return {
        "workspace_root": root_key,
        "chunk_count": count or 0,
        "last_indexed_at": last_updated.isoformat() if last_updated else None,
        "indexed": bool(count),
    }


def semantic_search(workspace_root: Path, query: str, top_k: int = 8) -> list[dict]:
    root_key = str(workspace_root.resolve())
    vec = embedding_service.embed(query)
    if vec is None:
        return []
    vec_literal = "[" + ",".join(str(x) for x in vec) + "]"

    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT file_path, symbol_name, symbol_type, start_line, end_line, content,
                   ROUND(CAST(1 - (embedding <=> %s::vector) AS numeric), 3) AS score
            FROM code_chunks
            WHERE workspace_root = %s
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (vec_literal, root_key, vec_literal, top_k),
        )
        results = cur.fetchall()
    finally:
        conn.close()

    return [
        {
            "file_path": r[0], "symbol_name": r[1], "symbol_type": r[2],
            "start_line": r[3], "end_line": r[4], "content": r[5], "score": float(r[6]),
        }
        for r in results
    ]


def grep_search(workspace_root: Path, query: str, max_results: int = 50) -> list[dict]:
    """Plain case-insensitive keyword search across indexable files (no rg binary needed)."""
    if not query.strip():
        return []
    pattern = re.compile(re.escape(query), re.IGNORECASE)
    results = []
    for path in _iter_files(workspace_root):
        if len(results) >= max_results:
            break
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        rel = path.relative_to(workspace_root).as_posix()
        for lineno, line in enumerate(text.splitlines(), start=1):
            if pattern.search(line):
                results.append({"file_path": rel, "line": lineno, "text": line.strip()[:300]})
                if len(results) >= max_results:
                    break
    return results
