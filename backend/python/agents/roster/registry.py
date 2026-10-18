from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agents.roster.base_agent import BaseAgent


class AgentRegistry:
    """Maps agent names to instances. Lazily imports to avoid circular deps."""

    def __init__(self):
        self._agents: dict[str, "BaseAgent"] = {}

    def register(self, agent: "BaseAgent"):
        self._agents[agent.name] = agent

    def get(self, name: str) -> "BaseAgent | None":
        return self._agents.get(name)

    def all(self) -> list["BaseAgent"]:
        return list(self._agents.values())

    def descriptions(self) -> list[dict]:
        """Return agent descriptors for use in Jazper's orchestrator prompt."""
        return [
            {
                "name": a.name,
                "description": a.description,
                "emoji": a.emoji,
                "model": a.model,
            }
            for a in self._agents.values()
        ]

    def _ensure_loaded(self):
        if self._agents:
            return
        from agents.roster.scout_agent import ScoutAgent
        from agents.roster.hermes_agent import HermesAgent
        from agents.roster.sage_agent import SageAgent
        from agents.roster.lens_agent import LensAgent
        from agents.roster.atlas_agent import AtlasAgent
        from agents.roster.phantom_agent import PhantomAgent
        for cls in [ScoutAgent, HermesAgent, SageAgent, LensAgent, AtlasAgent, PhantomAgent]:
            instance = cls()
            self._agents[instance.name] = instance


# Singleton
agent_registry = AgentRegistry()
