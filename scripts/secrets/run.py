"""Run a command with centrally-managed secrets injected into its environment (never written to disk).

  python scripts/secrets/run.py --service backend --env dev -- python backend/python/run_server.py
  python scripts/secrets/run.py --service backend --mock    -- python -m pytest   (non-sensitive fixtures, dev only)

Vendor is chosen by --vendor / JAZPER_SECRETS_VENDOR (default doppler; infisical supported). Doppler reads its scope from
DOPPLER_TOKEN (CI/hosting) or `doppler setup` (developer laptop); Infisical from INFISICAL_TOKEN + --projectId settings.
After injection the child validates required secrets (fail closed) before the real command runs.
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend" / "python"))
from core import secrets_guard as sg  # noqa: E402

VENDOR_CMD = {
    "doppler": lambda env, svc: ["doppler", "run", "--"],
    "infisical": lambda env, svc: ["infisical", "run", f"--env={env}", "--"],
}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--service", required=True, choices=["backend", "infra", "frontend", "app"])
    ap.add_argument("--env", default=None, help="dev | staging | prod (default: JAZPER_ENV or dev)")
    ap.add_argument("--vendor", default=os.environ.get("JAZPER_SECRETS_VENDOR", "doppler"), choices=sorted(VENDOR_CMD))
    ap.add_argument("--mock", action="store_true", help="use non-sensitive fixtures instead of the vault (dev only)")
    ap.add_argument("--check-only", action="store_true", help="validate and exit (internal use by the vendor wrapper)")
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    a = ap.parse_args(argv)
    cmd = a.cmd[1:] if a.cmd[:1] == ["--"] else a.cmd

    try:
        env = sg.normalize_env(a.env or os.environ.get("JAZPER_ENV") or "dev")
        if a.mock:
            os.environ["JAZPER_SECRETS_MODE"] = "mock"
        if a.check_only or a.mock:
            sg.enforce(a.service, env)  # mock fills os.environ in place; vault mode validates what was injected
            if a.check_only and not cmd:
                print(f"secrets OK for {a.service}/{env}")
                return 0
            return subprocess.call(cmd, env=os.environ.copy()) if cmd else 0
        if not cmd:
            ap.error("no command given after --")
        vendor_cli = VENDOR_CMD[a.vendor](env, a.service)
        if not shutil.which(vendor_cli[0]):
            print(f"{vendor_cli[0]} CLI not found. Install it (docs/SECRETS_ARCHITECTURE.md#local-onboarding) "
                  "or use --mock for non-sensitive fixtures.", file=sys.stderr)
            return 2
        os.environ["JAZPER_ENV"] = env
        inner = [sys.executable, str(Path(__file__).resolve()), "--service", a.service, "--env", env, "--check-only", "--", *cmd]
        return subprocess.call([*vendor_cli, *inner])
    except sg.SecretsError as e:
        print(f"secrets check failed: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
