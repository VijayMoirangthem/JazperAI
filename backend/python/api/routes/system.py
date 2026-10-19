"""System status, secret management (write-only) and backups (aliased /api/v1/system)."""
import asyncio
import re
import shutil
import subprocess
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core import vault
from memory.db import aio

router = APIRouter()
ROOT = Path(__file__).resolve().parents[4]
KNOWN_SECRETS = ["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TELEGRAM_BOT_TOKEN", "BACKUP_PASSPHRASE"]
NAME_RX = re.compile(r"^[A-Za-z0-9_.-]{2,80}$")


class SecretIn(BaseModel):
    name: str
    value: str


@router.get("/health")
async def health():
    checks: dict[str, dict] = {}

    async def check(name, fn):
        t = time.perf_counter()
        try:
            detail = await fn()
            checks[name] = {"ok": True, "detail": detail, "ms": int((time.perf_counter() - t) * 1000)}
        except Exception as e:
            checks[name] = {"ok": False, "detail": str(e)[:160], "ms": int((time.perf_counter() - t) * 1000)}

    async def db():
        n = (await aio.fetch("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema IN ('public','shared','co')"))[0]["n"]
        return f"{n} tables"

    async def redis():
        from memory.redis import layer
        if not await layer.health():
            raise RuntimeError("redis unreachable")
        return "pong"

    async def llm():
        rows = await aio.fetch("SELECT slug, secret_name, secret_env, local FROM shared.llm_providers WHERE enabled")
        from core.llm.registry import _secret
        usable = [r["slug"] for r in rows if _secret(r) or r["local"]]
        if not usable:
            raise RuntimeError("no provider with a key (add one in AI Providers or Secrets)")
        return "usable: " + ", ".join(usable)

    async def mcp():
        n = (await aio.fetch("SELECT count(*) AS n FROM shared.mcp_connectors WHERE enabled"))[0]["n"]
        return f"{n} connectors"

    async def disk():
        free = shutil.disk_usage(ROOT).free / 1e9
        if free < 5:
            raise RuntimeError(f"only {free:.1f} GB free")
        return f"{free:.0f} GB free"

    async def backup():
        dirs = sorted(p for p in (ROOT / "storage" / "backups").glob("2*") if p.is_dir())
        if not dirs:
            raise RuntimeError("no backup yet")
        age_h = (time.time() - dirs[-1].stat().st_mtime) / 3600
        if age_h > 24 * 7:
            raise RuntimeError(f"last backup {age_h / 24:.0f} days ago")
        return f"last backup {age_h:.0f} h ago"

    for name, fn in [("database", db), ("redis", redis), ("llm", llm), ("mcp", mcp), ("disk", disk), ("backup", backup)]:
        await check(name, fn)
    return {"ok": all(c["ok"] for c in checks.values()), "checks": checks}


@router.get("/secrets")
async def secrets():
    out = []
    for name in KNOWN_SECRETS + [r["secret_name"] for r in await aio.fetch("SELECT secret_name FROM shared.llm_providers WHERE secret_name IS NOT NULL")]:
        try:
            out.append({"name": name, "set": bool(vault.get(name))})
        except vault.VaultUnavailable:
            raise HTTPException(503, "OS keystore unavailable")
    return {"secrets": list({s["name"]: s for s in out}.values())}


@router.put("/secrets")
async def put_secret(body: SecretIn):
    if not NAME_RX.match(body.name) or not body.value.strip():
        raise HTTPException(422, "invalid name or empty value")
    try:
        vault.set(body.name, body.value)
    except vault.VaultUnavailable:
        raise HTTPException(503, "OS keystore unavailable")
    from core.llm import registry
    registry.invalidate()  # providers pick up a new key immediately
    return {"name": body.name, "set": True}


@router.delete("/secrets/{name}")
async def delete_secret(name: str):
    if not NAME_RX.match(name):
        raise HTTPException(422, "invalid name")
    vault.delete(name)
    from core.llm import registry
    registry.invalidate()
    return {"name": name, "set": False}


@router.post("/backup")
async def backup():
    script = ROOT / "scripts" / "backup.ps1"
    p = await asyncio.to_thread(subprocess.run, ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)],
                                capture_output=True, text=True, timeout=600)
    if p.returncode != 0:
        raise HTTPException(500, (p.stderr or p.stdout)[-300:])
    return {"ok": True, "output": p.stdout.strip()[-200:]}


LOG_FILES = {"backend": "backend.err.log", "backend-out": "backend.out.log", "renderer": "renderer.err.log", "launcher": "launcher.log", "watchdog": "watchdog.log"}


@router.get("/logs")
async def logs(name: str = "backend", lines: int = 200):
    fn = LOG_FILES.get(name)
    if not fn:
        raise HTTPException(404, f"log must be one of {list(LOG_FILES)}")
    p = ROOT / "storage" / "logs" / fn
    if not p.exists():
        return {"name": name, "lines": []}
    data = p.read_bytes()[-200_000:].decode("utf-8", errors="replace")
    text = [l for l in data.splitlines() if l.strip()][-max(1, min(lines, 1000)):]
    # never echo anything that looks like a key
    import re as _re
    text = [_re.sub(r"(sk-[A-Za-z0-9_-]{12,}|gsk_[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})", "<redacted>", l) for l in text]
    return {"name": name, "lines": text}
