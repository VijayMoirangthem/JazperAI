"""Folder access for bots.

- A group (baeit, boardmint, ...) may work only inside the folders attached to it (shared.workspaces).
- Jasper (chief) may read anywhere on this PC; writes anywhere are still gated (Tier 2) and deletes are not offered.
- Never readable or writable, for anyone: secret files (.env, keys, certificates, credential stores) and OS-protected folders.
- Writes use core.hitl (action file.write = Tier 2: notify + veto window; "Ask" level waits for you). Every write is audited via the comms log.
Tools exposed to bots (see agents/jasper_tools.py): fs_roots, fs_list, fs_read, fs_search, fs_write.
"""
import fnmatch
import os
import string
from pathlib import Path

from memory.db import aio

MAX_READ = 20_000
MAX_WRITE = 200_000
MAX_LIST = 200
MAX_HITS = 25
SKIP_DIRS = {"node_modules", ".git", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".idea", ".vscode"}
DENY_NAMES = (".env", ".env.*", "*.pem", "*.key", "*.pfx", "*.p12", "id_rsa*", "id_ed25519*", "*.kdbx", "credentials*", "secrets.*", "*.keystore", ".npmrc", ".pypirc")
DENY_PARTS = {".ssh", ".aws", ".gnupg", ".azure"}
DENY_WRITE_PREFIXES = ("c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata")
SEEDS = {"baeit": r"D:\Projects\baeit", "boardmint": r"D:\Projects\Boardmint"}

_cache: dict[str, list[dict]] = {}  # org_group -> [{id,path,mode,label}]
GROUP_OF: dict[str, str] = {}  # bot slug -> org_group (filled by agents.orgchart)


async def reload() -> None:
    _cache.clear()
    for r in await aio.fetch("SELECT id, org_group, path, label, mode FROM shared.workspaces ORDER BY id"):
        _cache.setdefault(r["org_group"], []).append(dict(r))


async def ensure_seeds() -> None:
    for group, path in SEEDS.items():
        if Path(path).is_dir():
            await aio.execute("INSERT INTO shared.workspaces(org_group, path, label) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", group, path, Path(path).name)
    await reload()


def drives() -> list[str]:
    return [f"{d}:\\" for d in string.ascii_uppercase if os.path.exists(f"{d}:\\")]


def roots_for(slug: str) -> list[dict]:
    """[{path, mode}] this bot may use. Jasper: every drive (read; writes gated)."""
    if slug == "jasper":
        return [{"path": d, "mode": "read-write", "label": d} for d in drives()]
    return _cache.get(GROUP_OF.get(slug, ""), [])


def has_workspace(slug: str) -> bool:
    return bool(roots_for(slug))


def _denied(p: Path) -> str | None:
    parts = {x.lower() for x in p.parts}
    if parts & DENY_PARTS:
        return "protected folder"
    if any(fnmatch.fnmatch(p.name.lower(), pat) for pat in DENY_NAMES):
        return "secret file"
    return None


def resolve(slug: str, raw: str, write: bool = False) -> tuple[Path | None, str]:
    """Returns (path, "") when allowed, else (None, reason)."""
    if not raw:
        return None, "path required"
    try:
        p = Path(raw).expanduser().resolve()
    except Exception:
        return None, "invalid path"
    roots = roots_for(slug)
    if not roots:
        return None, "this bot has no workspace attached (add one in Connections > Workspaces)"
    hit = next((r for r in roots if p == Path(r["path"]).resolve() or Path(r["path"]).resolve() in p.parents), None)
    if not hit:
        return None, "outside this bot's workspace folders: " + ", ".join(r["path"] for r in roots)[:200]
    reason = _denied(p)
    if reason:
        return None, f"blocked ({reason})"
    if write:
        if hit["mode"] == "read":
            return None, "workspace is read-only"
        if str(p).lower().startswith(DENY_WRITE_PREFIXES) or SKIP_DIRS & {x.lower() for x in p.parts}:
            return None, "blocked (protected location)"
    return p, ""


def list_dir(slug: str, raw: str) -> str:
    p, why = resolve(slug, raw)
    if not p:
        return "error: " + why
    if not p.is_dir():
        return "error: not a folder"
    rows = []
    for c in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))[:MAX_LIST]:
        if c.name.lower() in SKIP_DIRS or _denied(c):
            continue
        rows.append(f"{'[dir] ' if c.is_dir() else ''}{c.name}" + ("" if c.is_dir() else f" ({c.stat().st_size} B)"))
    return "\n".join(rows) or "(empty)"


def read_file(slug: str, raw: str, max_chars: int = MAX_READ) -> str:
    p, why = resolve(slug, raw)
    if not p:
        return "error: " + why
    if not p.is_file():
        return "error: not a file"
    try:
        data = p.read_bytes()[: max_chars * 4]
        if b"\x00" in data[:2000]:
            return f"error: binary file ({p.stat().st_size} B)"
        text = data.decode("utf-8", "replace")
        return text[:max_chars] + ("\n…[truncated]" if len(text) > max_chars else "")
    except OSError as e:
        return f"error: {e}"


def search(slug: str, query: str, raw: str = "") -> str:
    roots = [Path(r["path"]) for r in roots_for(slug)] if not raw else []
    if raw:
        p, why = resolve(slug, raw)
        if not p:
            return "error: " + why
        roots = [p]
    q, hits = query.lower(), []
    if not q:
        return "error: query required"
    for root in roots[:3]:
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d.lower() not in SKIP_DIRS and not d.lower() in DENY_PARTS]
            for f in files:
                fp = Path(dirpath) / f
                if _denied(fp):
                    continue
                if q in f.lower():
                    hits.append(f"{fp} (name)")
                elif fp.suffix.lower() in {".md", ".txt", ".py", ".ts", ".tsx", ".js", ".json", ".yml", ".yaml", ".toml", ".sql", ".html", ".css", ".csv", ".kt", ".java", ".dart"} and fp.stat().st_size < 400_000:
                    try:
                        for i, line in enumerate(fp.read_text("utf-8", "ignore").splitlines(), 1):
                            if q in line.lower():
                                hits.append(f"{fp}:{i}: {line.strip()[:120]}")
                                break
                    except OSError:
                        pass
                if len(hits) >= MAX_HITS:
                    return "\n".join(hits)
    return "\n".join(hits) or "no matches"


def write_file(slug: str, raw: str, content: str) -> tuple[Path | None, str]:
    """Validate only; the caller gates it with hitl, then calls commit_write."""
    p, why = resolve(slug, raw, write=True)
    if not p:
        return None, why
    if len(content) > MAX_WRITE:
        return None, "content too large"
    return p, ""


def commit_write(p: Path, content: str) -> str:
    p.parent.mkdir(parents=True, exist_ok=True)
    existed = p.exists()
    if existed:  # keep one backup so any write is reversible
        p.with_name(p.name + ".jasper-bak").write_bytes(p.read_bytes())
    p.write_text(content, encoding="utf-8")
    return f"{'overwrote' if existed else 'created'} {p} ({len(content)} chars)" + (" (backup: .jasper-bak)" if existed else "")


async def add(org_group: str, path: str, mode: str = "read-write") -> dict:
    p = Path(path).expanduser().resolve()
    if not p.is_dir():
        raise ValueError("folder does not exist")
    await aio.execute("INSERT INTO shared.workspaces(org_group, path, label, mode) VALUES($1,$2,$3,$4) ON CONFLICT (org_group, path) DO UPDATE SET mode=$4", org_group, str(p), p.name, mode)
    await reload()
    return {"org_group": org_group, "path": str(p), "mode": mode}


async def remove(wid: int) -> None:
    await aio.execute("DELETE FROM shared.workspaces WHERE id=$1", wid)
    await reload()


def browse(path: str) -> dict:
    """Folder picker data (Jasper-level; only lists folders). Empty path = drives."""
    if not path:
        return {"path": "", "parent": None, "dirs": drives()}
    p = Path(path).expanduser().resolve()
    if not p.is_dir():
        raise ValueError("not a folder")
    dirs = []
    try:
        for c in sorted(p.iterdir(), key=lambda x: x.name.lower()):
            if c.is_dir() and not c.name.startswith(("$", ".")) and c.name.lower() not in {"windows", "system volume information"}:
                dirs.append(str(c))
    except PermissionError:
        pass
    return {"path": str(p), "parent": str(p.parent) if p.parent != p else "", "dirs": dirs[:300]}
