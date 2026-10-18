"""Hybrid directory seed (spec §25, audit §3.4). Static seed; DB persistence arrives with the async layer (P1-08).

Existing persona agents -> lifecycle "active"; spec roles with no implementation yet -> lifecycle "spec".
"""
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict


class BotLifecycle(str, Enum):
    SPEC = "spec"
    ACTIVE = "active"


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TenantMembership(Strict):
    tenant: str
    roles: list[str]
    scopes: list[str] = []


class HumanProfile(Strict):
    kind: Literal["human"] = "human"
    id: str
    display_name: str
    email: str
    employment: Literal["employee", "contractor", "intern", "founder"]
    authority_level: int
    tenant_memberships: list[TenantMembership]


class BotPersona(Strict):
    kind: Literal["bot"] = "bot"
    id: str
    display_name: str
    role_title: str
    crew: str
    reports_to: str
    lifecycle: BotLifecycle
    tenant_memberships: list[TenantMembership]


TENANTS = ["create_origins", "baeit", "boardmint"]
# C-15: founder profile taken from git config; to be confirmed by the user.
FOUNDER = HumanProfile(
    id="founder", display_name="Vijay Moirangthem", email="vijaymoirangthem9@gmail.com", employment="founder",
    authority_level=5, tenant_memberships=[TenantMembership(tenant=t, roles=["founder"], scopes=["*:*:*"]) for t in TENANTS],
)

# (id, role_title, crew) — existing agents mapped per audit §3.4 (proposed, unverified)
_ACTIVE = [
    ("jasper", "Sir Jasper — Chief Orchestrator", "l1"),
    ("commander", "Task Dispatcher Bot", "coreops"), ("pulse", "Fast Cache & State Router Bot", "coreops"),
    ("shield", "Infrastructure & DevOps Bot", "it"), ("probe", "QA & Simulation Bot", "baeit"),
    ("verdict", "QA & Simulation Bot", "baeit"), ("forge", "Backend Services Bot", "baeit"),
    ("scribe", "Corporate Secretary Bot", "boardmint"), ("scroll", "Document Archival Bot", "boardmint"),
    ("sage", "Document Archival Bot", "boardmint"), ("hermes", "AI Tool Discovery & Benchmark Bot", "rnd"),
    ("darwin", "Algorithmic Experimentation Bot", "rnd"), ("scout", "Personal Assistant — research", "personal"),
    ("atlas", "Personal Assistant — schedule", "personal"), ("aria", "Unmapped persona", "unmapped"),
    ("lens", "Unmapped persona", "unmapped"), ("oracle", "Unmapped persona (reasoning)", "unmapped"),
    ("phantom", "Unmapped persona (scraping)", "unmapped"), ("voyager", "Unmapped persona (UI testing)", "unmapped"),
]
_SPEC = [
    ("incident-response", "Incident Response Bot", "coreops"), ("mobile-dev", "Mobile Dev Bot", "baeit"),
    ("legal-compliance", "Legal & Compliance Bot", "boardmint"), ("finops", "FinOps Bot", "sre"),
    ("chaos", "ChaosBot", "sre"), ("travelops", "TravelOps Bot", "people"), ("peopleops", "PeopleOps Bot", "people"),
]


def _bot(id_: str, title: str, crew: str, lifecycle: BotLifecycle) -> BotPersona:
    tenants = {"baeit": ["baeit"], "boardmint": ["boardmint"]}.get(crew, TENANTS)
    return BotPersona(
        id=id_, display_name=id_.replace("-", " ").title(), role_title=title, crew=crew,
        reports_to="founder" if id_ == "jasper" else "jasper", lifecycle=lifecycle,
        tenant_memberships=[TenantMembership(tenant=t, roles=["bot_tier1"]) for t in tenants],
    )


def bots() -> list[BotPersona]:
    return [_bot(i, t, c, BotLifecycle.ACTIVE) for i, t, c in _ACTIVE] + [
        _bot(i, t, c, BotLifecycle.SPEC) for i, t, c in _SPEC
    ]


def humans() -> list[HumanProfile]:
    return [FOUNDER]
