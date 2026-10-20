"""One-time (idempotent) MinIO setup: credentials -> vault + infra/.env, start the containers, create buckets.

    backend\\.venv\\Scripts\\python.exe scripts\\setup_minio.py

infra/.env is git-ignored. The same credentials are stored in the OS vault (MINIO_ACCESS_KEY / MINIO_SECRET_KEY) for the backend.
"""
import secrets
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend" / "python"))
ENV = ROOT / "infra" / ".env"


def env_lines() -> list[str]:
    return ENV.read_text(encoding="utf-8").splitlines() if ENV.exists() else []


def get(name: str) -> str | None:
    for ln in env_lines():
        if ln.startswith(name + "="):
            return ln.split("=", 1)[1].strip()
    return None


def main() -> None:
    from core import vault
    user, pw = get("MINIO_ROOT_USER"), get("MINIO_ROOT_PASSWORD")
    if not user or not pw:
        user, pw = "jasperadmin", secrets.token_urlsafe(24)
        with ENV.open("a", encoding="utf-8") as f:
            f.write(f"\nMINIO_ROOT_USER={user}\nMINIO_ROOT_PASSWORD={pw}\n")
        print("generated MinIO credentials (infra/.env, git-ignored)")
    vault.set("MINIO_ACCESS_KEY", user)
    vault.set("MINIO_SECRET_KEY", pw)
    subprocess.run(["docker", "compose", "up", "-d", "minio", "wal-shipper"], cwd=ROOT / "infra", check=True)
    from core import objectstore
    for _ in range(40):
        if objectstore.available():
            break
        time.sleep(1.5)
    else:
        raise SystemExit("MinIO did not become reachable on 127.0.0.1:9000")
    print("buckets:", objectstore.ensure_buckets())


if __name__ == "__main__":
    main()
