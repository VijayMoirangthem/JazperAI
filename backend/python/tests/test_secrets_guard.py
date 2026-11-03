"""Secrets management: fail-closed, environment isolation, no leakage, mock mode. Uses fake, non-sensitive values only."""
import subprocess
import sys
from pathlib import Path

import pytest

from core import secrets_guard as sg

ROOT = Path(__file__).resolve().parents[3]
FAKE = "fake-value-DO-NOT-LEAK-12345"
ALL_PROD = {"POSTGRES_PASSWORD": FAKE, "REDIS_PASSWORD": FAKE, "MINIO_ROOT_PASSWORD": FAKE, "AI_API_KEY": FAKE, "WS_TOKEN": FAKE}


def test_missing_required_fails_closed_in_prod_names_only():
    env = {"POSTGRES_PASSWORD": FAKE}
    with pytest.raises(sg.SecretsError) as e:
        sg.enforce("backend", "prod", env)
    msg = str(e.value)
    assert "REDIS_PASSWORD" in msg and "WS_TOKEN" in msg
    assert FAKE not in msg


def test_complete_prod_environment_passes():
    assert sg.enforce("backend", "production", dict(ALL_PROD)) == "prod"


def test_empty_string_counts_as_missing():
    env = {**ALL_PROD, "AI_API_KEY": ""}
    with pytest.raises(sg.SecretsError, match="AI_API_KEY"):
        sg.enforce("backend", "staging", env)


def test_environment_isolation_prod_requirements_not_applied_to_dev_and_unknown_env_rejected():
    dev_env = {"POSTGRES_PASSWORD": FAKE, "REDIS_PASSWORD": FAKE}
    assert sg.enforce("backend", "dev", dev_env) == "dev"  # WS_TOKEN etc. are only required in staging/prod
    with pytest.raises(sg.SecretsError):
        sg.enforce("backend", "prod", dev_env)
    with pytest.raises(sg.SecretsError, match="unknown environment"):
        sg.enforce("backend", "qa", dev_env)


def test_service_scoping_frontend_requires_no_server_secrets():
    assert sg.enforce("frontend", "prod", {}) == "prod"


def test_mock_mode_fills_from_fixture_in_dev_and_never_overrides_real_values():
    env = {"JAZPER_SECRETS_MODE": "mock", "POSTGRES_PASSWORD": "already-set"}
    assert sg.enforce("backend", "dev", env) == "dev"
    assert env["POSTGRES_PASSWORD"] == "already-set"
    assert env["REDIS_PASSWORD"].startswith("mock-")


@pytest.mark.parametrize("target", ["staging", "prod"])
def test_mock_mode_refused_outside_dev(target):
    with pytest.raises(sg.SecretsError, match="mock secrets are refused"):
        sg.enforce("backend", target, {"JAZPER_SECRETS_MODE": "mock"})


def test_unknown_mode_rejected():
    with pytest.raises(sg.SecretsError, match="JAZPER_SECRETS_MODE"):
        sg.enforce("backend", "dev", {"JAZPER_SECRETS_MODE": "magic"})


def test_secret_under_public_prefix_is_rejected_without_echoing_value():
    env = {**ALL_PROD, "VITE_AI_API_KEY": FAKE}
    with pytest.raises(sg.SecretsError) as e:
        sg.enforce("backend", "prod", env)
    assert "VITE_AI_API_KEY" in str(e.value) and FAKE not in str(e.value)


def test_mock_fixture_contains_only_obvious_placeholders():
    for k, v in sg.parse_env_file(sg.FIXTURE).items():
        assert v.startswith("mock-") and v.endswith("not-a-secret"), k


def _run(*args, env_extra=None):
    import os
    env = {k: v for k, v in os.environ.items() if k not in ALL_PROD and not k.startswith("JAZPER_")}
    env.update(env_extra or {})
    return subprocess.run([sys.executable, str(ROOT / "scripts" / "secrets" / "run.py"), *args],
                          capture_output=True, text=True, env=env)


def test_launcher_mock_runs_child_with_fixtures_and_does_not_print_values():
    r = _run("--service", "backend", "--mock", "--", sys.executable, "-c",
             "import os; print('has' if os.environ['REDIS_PASSWORD'] else 'no')")
    assert r.returncode == 0 and r.stdout.strip() == "has"
    assert "mock-redis" not in r.stdout + r.stderr


def test_launcher_check_only_fails_closed_with_missing_secrets_and_leaks_nothing():
    r = _run("--service", "backend", "--env", "prod", "--check-only", env_extra={"POSTGRES_PASSWORD": FAKE})
    assert r.returncode == 3
    assert "REDIS_PASSWORD" in r.stderr and FAKE not in r.stdout + r.stderr


def test_launcher_refuses_mock_in_prod():
    r = _run("--service", "backend", "--env", "prod", "--mock", "--", sys.executable, "-c", "print(1)")
    assert r.returncode == 3 and "refused" in r.stderr


def test_launcher_reports_missing_vendor_cli(monkeypatch):
    r = _run("--service", "backend", "--env", "dev", "--vendor", "infisical", "--", sys.executable, "-c", "print(1)",
             env_extra={"PATH": ""})
    assert r.returncode == 2 and "CLI not found" in r.stderr


def test_env_example_templates_are_in_sync_with_manifest_and_contain_no_values():
    for script in ("gen_env_examples.py --check", "check_repo.py"):
        name, *rest = script.split()
        r = subprocess.run([sys.executable, str(ROOT / "scripts" / "secrets" / name), *rest], capture_output=True, text=True, cwd=ROOT)
        assert r.returncode == 0, r.stderr


def test_manifest_covers_every_settings_field_that_looks_like_a_secret(monkeypatch):
    monkeypatch.setenv("POSTGRES_PASSWORD", "fake-not-a-secret")  # Settings() requires these at import time
    monkeypatch.setenv("REDIS_PASSWORD", "fake-not-a-secret")
    from core.config import Settings
    m = sg.load_manifest()
    names = {v["name"] for v in m["variables"]}
    secrety = [f for f in Settings.model_fields if any(t in f for t in ("KEY", "PASSWORD", "SECRET", "TOKEN"))]
    assert [f for f in secrety if f not in names] == []
    kinds = {v["name"]: v["kind"] for v in m["variables"]}
    assert [f for f in secrety if kinds[f] != "secret"] == []
