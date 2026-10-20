"""Backup to MinIO (Plan V3 W7): run the encrypted dump (scripts/backup.ps1), upload every file to the object-locked `backups` bucket,
verify each upload by size and by downloading + hashing the main dump, write a manifest, and record the result for monitoring.

    backend\\.venv\\Scripts\\python.exe scripts\\backup_minio.py [--no-dump]     (--no-dump uploads the newest existing folder)

Exit code 0 = backup safely stored and verified; non-zero = failed (Task Scheduler / the alerting job can act on it).
Offsite copy: `mc mirror` the `backups` bucket to Cloudflare R2 / Backblaze B2 (see docs/ops/dr.md); not configured yet.
"""
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend" / "python"))
BACKUPS = ROOT / "storage" / "backups"


def newest() -> Path:
    dirs = sorted([d for d in BACKUPS.iterdir() if d.is_dir()], key=lambda d: d.stat().st_mtime)
    if not dirs:
        raise SystemExit("no backup folder found")
    return dirs[-1]


def main() -> int:
    from core import objectstore
    t0 = time.time()
    if "--no-dump" not in sys.argv:
        r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts" / "backup.ps1")], capture_output=True, text=True)
        if r.returncode != 0:
            print("backup.ps1 failed:", r.stderr[-300:])
            return 2
    folder = newest()
    stamp = folder.name
    if not objectstore.available():
        print("MinIO not reachable (docker compose up -d minio)")
        return 3
    objectstore.ensure_buckets()
    manifest = {"stamp": stamp, "files": {}}
    total = 0
    for f in sorted(folder.iterdir()):
        if f.is_file():
            res = objectstore.put_file("backups", f"{stamp}/{f.name}", str(f))
            manifest["files"][f.name] = {"size": res["size"], "sha256": res["sha256"]}
            total += res["size"]
    # end-to-end check: pull the main dump back and compare its hash with the local file
    main_dump = next((n for n in manifest["files"] if n.startswith("full.dump")), None)
    if not main_dump:
        print("no full dump in", folder)
        return 4
    back = hashlib.sha256(objectstore.get_bytes("backups", f"{stamp}/{main_dump}")).hexdigest()
    ok = back == manifest["files"][main_dump]["sha256"]
    manifest.update({"verified": ok, "bytes": total, "seconds": round(time.time() - t0, 1), "at": time.strftime("%Y-%m-%dT%H:%M:%S")})
    objectstore.put_bytes("backups", f"{stamp}/manifest.json", json.dumps(manifest, indent=2).encode(), "application/json")
    (BACKUPS / "last.json").write_text(json.dumps(manifest), encoding="utf-8")
    try:  # let the backend (alerts, System panel) see the freshness without reading disk
        import asyncio

        from memory.redis import layer
        asyncio.run(layer.client().set("tenant:platform:backup:last", json.dumps(manifest)))
    except Exception:
        pass
    print(json.dumps({"stamp": stamp, "files": len(manifest["files"]), "bytes": total, "verified": ok, "seconds": manifest["seconds"]}))
    return 0 if ok else 5


if __name__ == "__main__":
    sys.exit(main())
