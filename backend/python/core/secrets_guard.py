"""Fail-closed validation of injected secrets (docs/SECRETS_ARCHITECTURE.md). Stdlib only, so scripts can import it
before backend dependencies exist.

The vendor CLI (`doppler run` / `infisical run`) injects secrets as environment variables; this module never talks to a
vendor and never writes secrets to disk. Error messages carry variable NAMES only, never values.

Modes (JAZPER_SECRETS_MODE): "vault" (default) = trust the injected environment; "mock" = load the non-sensitive fixture
file for local/CI tests. Mock mode is refused in staging/prod.
"""
import json
import os
from pathlib import Path

ENV_ALIASES = {"development": "dev", "dev": "dev", "local": "dev", "test": "dev", "staging": "staging", "stage": "staging",
               "production": "prod", "prod": "prod"}
FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "mock_secrets.env"


class SecretsError(RuntimeError):
    pass


def find_manifest() -> Path:
    override = os.environ.get("JAZPER_SECRETS_MANIFEST")
    if override:
        return Path(override)
    for parent in Path(__file__).resolve().parents:
        cand = parent / "config" / "secrets.manifest.json"
        if cand.is_file():
            return cand
    raise SecretsError("secrets manifest not found (set JAZPER_SECRETS_MANIFEST)")


def load_manifest(path: Path | None = None) -> dict:
    return json.loads((path or find_manifest()).read_text(encoding="utf-8"))


def normalize_env(name: str | None) -> str:
    key = (name or "").strip().lower()
    if key not in ENV_ALIASES:
        raise SecretsError(f"unknown environment {key!r}; expected one of dev, staging, prod")
    return ENV_ALIASES[key]


def parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def apply_mock(environ, env: str, fixture: Path | None = None) -> list[str]:
    """Fill ONLY missing variables from the fixture file. Refused outside dev. Returns the names filled."""
    if env != "dev":
        raise SecretsError(f"mock secrets are refused in {env}")
    filled = []
    for k, v in parse_env_file(fixture or FIXTURE).items():
        if not environ.get(k):
            environ[k] = v
            filled.append(k)
    return filled


def missing_required(service: str, env: str, environ, manifest: dict | None = None) -> list[str]:
    m = manifest or load_manifest()
    return sorted(v["name"] for v in m["variables"]
                  if service in v["services"] and env in v.get("required_in", []) and not environ.get(v["name"]))


def public_leaks(environ, manifest: dict | None = None) -> list[str]:
    """Names of variables under a browser-exposed prefix (NEXT_PUBLIC_/VITE_) that embed a secret-kind variable name."""
    m = manifest or load_manifest()
    secret_names = {v["name"] for v in m["variables"] if v["kind"] == "secret"}
    return sorted(k for k in environ if k.startswith(("NEXT_PUBLIC_", "VITE_"))
                  and any(s in k for s in secret_names))


def enforce(service: str, env_name: str | None = None, environ=None, manifest: dict | None = None) -> str:
    """Validate the environment for `service`. Raises SecretsError (names only). Returns the normalized env."""
    environ = os.environ if environ is None else environ
    env = normalize_env(env_name or environ.get("JAZPER_ENV") or environ.get("ENV") or "dev")
    mode = (environ.get("JAZPER_SECRETS_MODE") or "vault").lower()
    if mode == "mock":
        apply_mock(environ, env)
    elif mode != "vault":
        raise SecretsError(f"unknown JAZPER_SECRETS_MODE {mode!r}")
    leaks = public_leaks(environ, manifest)
    if leaks:
        raise SecretsError("secret-like names under a public prefix: " + ", ".join(leaks))
    missing = missing_required(service, env, environ, manifest)
    if missing:
        raise SecretsError(f"missing required secrets for {service}/{env}: " + ", ".join(missing))
    return env
