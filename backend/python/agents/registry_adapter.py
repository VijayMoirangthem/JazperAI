"""Adapter exposing the legacy persona agents (agents.roster) in the unified roster; nothing regresses."""
from core import directory


def builtin_roster() -> list[dict]:
    return [
        {"slug": b.id, "display_name": b.display_name, "role_title": b.role_title, "crew": b.crew,
         "reports_to": b.reports_to, "lifecycle": b.lifecycle.value, "enabled": b.lifecycle.value == "active",
         "source": "builtin" if b.lifecycle.value == "active" else "spec"}
        for b in directory.bots()
    ]
