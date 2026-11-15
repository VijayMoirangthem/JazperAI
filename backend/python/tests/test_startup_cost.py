"""Start-up cost guards: heavy libraries and database work must not run at import time (they delayed every backend start by seconds)."""
import importlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_langgraph_graph_is_not_imported_until_a_graph_is_built():
    code = "import sys, agents.supervisor, agents.devloop, agents.exec_graph; print('langgraph.graph' in sys.modules)"
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, timeout=180)  # cwd is on sys.path for -c
    assert out.stdout.strip().splitlines()[-1] == "False", out.stdout[-300:] + out.stderr[-300:]


def test_triage_does_not_touch_the_database_at_import(monkeypatch):
    from memory.db import legacy_pg
    calls = []

    def boom():
        calls.append(1)
        raise RuntimeError("database is down")

    monkeypatch.setattr(legacy_pg, "_pg", boom)
    import api.routes.triage as triage
    importlib.reload(triage)
    assert calls == []                                              # importing is free


def test_triage_columns_are_ensured_on_first_use_and_retried_until_the_database_answers(monkeypatch):
    import api.routes.triage as triage
    answers = iter([False, True])                                   # first use: database unreachable; second: fine
    ensured = []
    monkeypatch.setattr(triage, "_ensure_triage_columns", lambda: ensured.append(1) or next(answers))
    monkeypatch.setattr(triage, "_pg", lambda: "conn")
    monkeypatch.setattr(triage, "_columns_ready", False)
    assert triage._db() == "conn" and len(ensured) == 1
    assert triage._db() == "conn" and len(ensured) == 2             # retried because the first attempt failed
    assert triage._db() == "conn" and len(ensured) == 2             # and not again once it worked
