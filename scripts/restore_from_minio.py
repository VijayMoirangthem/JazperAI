"""Restore drill from MinIO: download a backup set (default: newest) from the `backups` bucket, check every file's hash against its manifest,
then run scripts/restore.ps1 into the scratch database and print live-vs-scratch counts. Never touches the live database.

    backend\\.venv\\Scripts\\python.exe scripts\\restore_from_minio.py [stamp]
Prints the measured download / verify / restore seconds (use them for the RTO in docs/ops/dr.md).
"""
import hashlib
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend" / "python"))


def main() -> int:
    from core import objectstore
    keys = objectstore.list_keys("backups")
    stamps = sorted({k["key"].split("/")[0] for k in keys if "/" in k["key"]})
    if not stamps:
        print("no backups in MinIO")
        return 2
    stamp = sys.argv[1] if len(sys.argv) > 1 else stamps[-1]
    t0 = time.time()
    dest = Path(tempfile.mkdtemp(prefix="jasper-restore-")) / stamp
    dest.mkdir(parents=True)
    manifest = json.loads(objectstore.get_bytes("backups", f"{stamp}/manifest.json"))
    for name, meta in manifest["files"].items():
        data = objectstore.get_bytes("backups", f"{stamp}/{name}")
        if hashlib.sha256(data).hexdigest() != meta["sha256"]:
            print("HASH MISMATCH:", name)
            return 3
        (dest / name).write_bytes(data)
    t_dl = time.time() - t0
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts" / "restore.ps1"), "-Backup", str(dest)], capture_output=True, text=True)
    print(r.stdout.strip()[-400:])
    print(json.dumps({"stamp": stamp, "files": len(manifest["files"]), "download_verify_s": round(t_dl, 1), "restore_s": round(time.time() - t0 - t_dl, 1), "total_s": round(time.time() - t0, 1), "restore_exit": r.returncode}))
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
