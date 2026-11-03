"""Repo hygiene gate for secrets (run in CI and tests). Prints file paths / variable names only, never values.
Fails if: a tracked file is a real env file (.env, .env.local, ... but not *.example), or a tracked *.env.example /
frontend env file puts a non-empty value on a secret-kind variable, or a secret name sits under a NEXT_PUBLIC_/VITE_ prefix.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = re.compile(r"(^|/)\.env(\.[^/]+)?$")
ALLOWED_SUFFIX = (".example", ".sample", ".template")


def tracked() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout.decode()
    return [p for p in out.split("\0") if p]


def main() -> int:
    manifest = json.loads((ROOT / "config" / "secrets.manifest.json").read_text(encoding="utf-8"))
    secrets = {v["name"] for v in manifest["variables"] if v["kind"] == "secret"}
    problems = []
    for p in tracked():
        if ENV_FILE.search(p) and not p.endswith(ALLOWED_SUFFIX):
            problems.append(f"tracked env file: {p}")
        if p.endswith(ALLOWED_SUFFIX) and ".env" in p and (ROOT / p).is_file():
            for n, line in enumerate((ROOT / p).read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line.strip())
                if not m:
                    continue
                name, val = m.groups()
                if name in secrets and val.strip():
                    problems.append(f"{p}:{n} non-empty value for secret {name}")
                if name.startswith(("NEXT_PUBLIC_", "VITE_")) and any(s in name for s in secrets):
                    problems.append(f"{p}:{n} secret-like name under public prefix: {name}")
    for p in problems:
        print(p, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
