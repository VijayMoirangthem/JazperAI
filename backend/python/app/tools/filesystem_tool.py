"""
Filesystem tool — Phase 5 prerequisite for Forge (the Developer agent).

Forge uses these functions to read, edit, and backup codebase files.
All paths are validated against an allowlist so no agent can touch
sensitive files (.env, docker-compose.yml, DB migrations, etc.).

Safety rules (non-negotiable, match Create&SelfRepair.md Section 6):
  - Only files inside ALLOWED_ROOTS are readable/writable
  - FORBIDDEN_PATTERNS can never be written — only read at most
  - Every write creates a .bak backup first
  - write_diff() does exact string replacement — never a full overwrite
  - Path traversal (../../) is blocked
"""

import os
import shutil
import datetime
import structlog

log = structlog.get_logger()

# ── Safety configuration ──────────────────────────────────────────────────────

# Forge may read/write inside these directories only
_PROJECT_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")
)

ALLOWED_ROOTS = [
    os.path.join(_PROJECT_ROOT, "backend", "python", "app"),
    os.path.join(_PROJECT_ROOT, "frontend", "src"),
    os.path.join(_PROJECT_ROOT, "frontend", "public"),
    os.path.join(_PROJECT_ROOT, "backend", "python", "tests"),
]

# These files/patterns can NEVER be written by any agent (read-only at most)
FORBIDDEN_WRITE_PATTERNS = [
    ".env",
    ".env.local",
    ".env.example",
    "requirements.txt",
    "docker-compose.yml",
    "init.sql",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "next.config",
    "restart.bat",
]

ALLOWED_EXTENSIONS = {".py", ".ts", ".tsx", ".md", ".css", ".html", ".js"}


# ── Path validation ───────────────────────────────────────────────────────────

class FilesystemError(Exception):
    pass


def _resolve_and_validate(relative_path: str, for_write: bool = False) -> str:
    """
    Resolves relative_path against the project root and validates it.
    Raises FilesystemError if the path is outside allowed roots or forbidden.
    """
    # Block path traversal
    if ".." in relative_path.replace("\\", "/").split("/"):
        raise FilesystemError(f"Path traversal not allowed: {relative_path}")

    abs_path = os.path.abspath(os.path.join(_PROJECT_ROOT, relative_path))

    # Must be inside at least one allowed root
    in_allowed = any(abs_path.startswith(root) for root in ALLOWED_ROOTS)
    if not in_allowed:
        raise FilesystemError(
            f"Path '{relative_path}' is outside allowed directories. "
            f"Allowed: backend/python/app/, frontend/src/, backend/python/tests/"
        )

    # Check forbidden write patterns
    if for_write:
        filename = os.path.basename(abs_path)
        for pattern in FORBIDDEN_WRITE_PATTERNS:
            if pattern in filename or filename == pattern:
                raise FilesystemError(
                    f"Writing to '{filename}' is forbidden. "
                    f"Forbidden files: {', '.join(FORBIDDEN_WRITE_PATTERNS)}"
                )
        _, ext = os.path.splitext(abs_path)
        if ext and ext not in ALLOWED_EXTENSIONS:
            raise FilesystemError(
                f"Extension '{ext}' is not in the allowed write list: {ALLOWED_EXTENSIONS}"
            )

    return abs_path


# ── Read ──────────────────────────────────────────────────────────────────────

def read_codebase_file(relative_path: str) -> str:
    """
    Read any file inside the allowed roots.
    Used by Oracle (diagnosis) and Forge (read-before-write).

    Args:
        relative_path: path relative to project root, e.g.
                       "backend/python/app/agents/hermes_agent.py"

    Returns: file content as string.
    Raises: FilesystemError if path is invalid.
    """
    abs_path = _resolve_and_validate(relative_path, for_write=False)
    if not os.path.isfile(abs_path):
        raise FilesystemError(f"File not found: {relative_path}")
    with open(abs_path, "r", encoding="utf-8") as f:
        content = f.read()
    log.info("Filesystem: read file", path=relative_path, chars=len(content))
    return content


def list_codebase_files(
    directory: str,
    extensions: list[str] | None = None,
) -> list[str]:
    """
    List all files in a directory (relative paths from project root).
    Used by Oracle to explore the codebase structure.

    Args:
        directory: relative path to directory, e.g. "backend/python/app/agents"
        extensions: optional filter, e.g. [".py"]. None = all allowed extensions.

    Returns: list of relative paths.
    """
    abs_dir = _resolve_and_validate(directory, for_write=False)
    if not os.path.isdir(abs_dir):
        raise FilesystemError(f"Directory not found: {directory}")

    allowed_exts = set(extensions) if extensions else ALLOWED_EXTENSIONS
    results = []
    for root, _, files in os.walk(abs_dir):
        for fname in files:
            _, ext = os.path.splitext(fname)
            if ext in allowed_exts:
                full = os.path.join(root, fname)
                rel = os.path.relpath(full, _PROJECT_ROOT).replace("\\", "/")
                results.append(rel)
    return sorted(results)


# ── Backup ────────────────────────────────────────────────────────────────────

def backup_file(relative_path: str) -> str:
    """
    Create a timestamped .bak copy before any write operation.
    Always call this before write_codebase_diff() or create_codebase_file().

    Returns: path to the backup file.
    """
    abs_path = _resolve_and_validate(relative_path, for_write=False)
    if not os.path.isfile(abs_path):
        raise FilesystemError(f"Cannot back up — file not found: {relative_path}")

    ts = datetime.datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    bak_path = abs_path + f".{ts}.bak"
    shutil.copy2(abs_path, bak_path)
    log.info("Filesystem: backed up file", path=relative_path, bak=bak_path)
    return bak_path


def restore_backup(bak_path: str) -> bool:
    """
    Restore a file from its .bak backup.
    Darwin calls this if Shield returns FAIL after a write.

    Args:
        bak_path: absolute path to the .bak file (returned by backup_file).
    """
    if not os.path.isfile(bak_path):
        log.error("Filesystem: backup not found for restore", bak=bak_path)
        return False
    original_path = bak_path.rsplit(".", 2)[0]  # remove .TIMESTAMP.bak
    shutil.copy2(bak_path, original_path)
    os.remove(bak_path)
    log.info("Filesystem: restored from backup", original=original_path)
    return True


# ── Write (targeted diff only) ────────────────────────────────────────────────

def write_codebase_diff(
    relative_path: str,
    old_string: str,
    new_string: str,
    *,
    auto_backup: bool = True,
) -> bool:
    """
    Apply a targeted string replacement to a file — never a full overwrite.
    This is the ONLY way Forge is allowed to modify existing files.

    Args:
        relative_path: path relative to project root
        old_string: the exact substring to replace (must be unique in the file)
        new_string: the replacement string
        auto_backup: if True, creates a .bak before writing (default True)

    Returns: True on success.
    Raises:
        FilesystemError if path invalid, old_string not found, or not unique.
    """
    abs_path = _resolve_and_validate(relative_path, for_write=True)

    with open(abs_path, "r", encoding="utf-8") as f:
        content = f.read()

    count = content.count(old_string)
    if count == 0:
        raise FilesystemError(
            f"old_string not found in {relative_path}. Cannot apply diff."
        )
    if count > 1:
        raise FilesystemError(
            f"old_string appears {count} times in {relative_path}. "
            f"Make it more specific so the replacement is unambiguous."
        )

    if auto_backup:
        backup_file(relative_path)

    new_content = content.replace(old_string, new_string, 1)
    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(new_content)

    log.info(
        "Filesystem: applied diff",
        path=relative_path,
        old_len=len(old_string),
        new_len=len(new_string),
    )
    return True


# ── Create (new files only — Self-Create workflow) ────────────────────────────

def create_codebase_file(
    relative_path: str,
    content: str,
    *,
    overwrite: bool = False,
) -> bool:
    """
    Create a new file in the codebase.
    Only used in the Self-Create workflow — never during repair.

    Args:
        relative_path: path relative to project root
        content: full file content
        overwrite: if False (default), raises if file already exists

    Returns: True on success.
    """
    abs_path = _resolve_and_validate(relative_path, for_write=True)

    if os.path.exists(abs_path) and not overwrite:
        raise FilesystemError(
            f"File already exists: {relative_path}. "
            f"Pass overwrite=True to replace it (use with caution)."
        )

    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "w", encoding="utf-8") as f:
        f.write(content)

    log.info("Filesystem: created new file", path=relative_path, chars=len(content))
    return True


# ── Cleanup ───────────────────────────────────────────────────────────────────

def list_backups(relative_path: str) -> list[str]:
    """List all .bak files for a given source file."""
    abs_path = _resolve_and_validate(relative_path, for_write=False)
    directory = os.path.dirname(abs_path)
    basename = os.path.basename(abs_path)
    baks = [
        os.path.join(directory, f)
        for f in os.listdir(directory)
        if f.startswith(basename) and f.endswith(".bak")
    ]
    return sorted(baks)


def cleanup_old_backups(relative_path: str, keep: int = 3):
    """Keep only the N most recent .bak files to avoid disk bloat."""
    baks = list_backups(relative_path)
    to_delete = baks[:-keep] if len(baks) > keep else []
    for bak in to_delete:
        os.remove(bak)
        log.info("Filesystem: cleaned up old backup", bak=bak)
