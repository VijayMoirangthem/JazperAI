"""Organisation definition from the spec (§2, §16): executive tier and the modular sub-crews. Duties are quoted from the
spec; nothing is invented. Seeded into shared.bot_definitions by ensure_org() so they are normal hot-pluggable bots."""
from dataclasses import dataclass

from agents.registry import BotDef, registry
from memory.db import aio


@dataclass(frozen=True)
class Exec:
    slug: str
    title: str
    duty: str
    division: str  # tenant / division the executive leads
    keywords: tuple[str, ...]
    crews: tuple[str, ...]  # crews reporting to this executive


EXECUTIVES: list[Exec] = [
    Exec("ceo-create-origins", "CEO of Create Origins", "Head of Create Origins (Parent Company). Manages core corporate operations, umbrella holdings, shared enterprise services, brand strategy, and group expansion.",
         "create_origins", ("create origins", "holding", "brand", "expansion", "corporate", "travel", "hiring", "hr "), ("coreops", "people")),
    Exec("ceo-baeit", "CEO / Product Lead of Baeit", "Head of Baeit (Food Surplus Marketplace Division). Leads consumer food-surplus marketplace operations, restaurant partner relations, consumer app growth, and revenue operations.",
         "baeit", ("baeit", "marketplace", "restaurant", "merchant", "partner", "surplus", "app growth"), ("baeit",)),
    Exec("lead-boardmint", "Chief Governance Officer / Lead of Boardmint", "Head of Boardmint (Governance & Compliance Division). Manages compliance, board documentation, statutory reporting, corporate governance, and legal structuring.",
         "boardmint", ("boardmint", "compliance", "filing", "statutory", "board", "resolution", "governance", "legal"), ("boardmint",)),
    Exec("vp-tech-ops", "VP / Head of Technology & Operations", "Coordinates shared technical infrastructure, local LLM orchestration pipelines, database topologies, and internal tooling.",
         "create_origins", ("infra", "infrastructure", "devops", "database", "deploy", "server", "tooling", "llm", "electron", "architecture", "prototype", "benchmark", "experiment"), ("it", "rnd")),
    # parent-company tier stubs (§16); real responsibilities to be supplied by the founder
    Exec("cfo", "CFO / Treasury", "Parent-company finance and treasury (stub: details pending founder input).", "create_origins", ("budget", "treasury", "finance", "cost", "invoice"), ()),
    Exec("coo", "COO", "Parent-company operations (stub: details pending founder input).", "create_origins", ("operations plan", "process", "logistics"), ()),
    Exec("general-counsel", "General Counsel", "Parent-company legal (stub: details pending founder input).", "create_origins", ("contract", "nda", "counsel", "litigation"), ()),
]

# crew -> (display name, reports_to, [(slug, title, duty)])
CREWS: dict[str, tuple[str, str, list[tuple[str, str, str]]]] = {
    "it": ("Create Origins IT & Core Systems Crew", "vp-tech-ops", [
        ("infra-devops-bot", "Infrastructure & DevOps Bot", "System health, secure tunnels, cloud API rate-limiting, and key management."),
        ("desktop-ui-bot", "Desktop Shell & UI Engineer Bot", "Electron/React maintenance."),
        ("enterprise-architect-bot", "Enterprise Architect Bot", "High-level infrastructure alignment and system design.")]),
    "baeit": ("Baeit Engineering & Operations Crew", "ceo-baeit", [
        ("mobile-dev-bot", "Mobile App Dev Bot", "Android/React Native client management."),
        ("backend-services-bot", "Backend Services Bot", "FastAPI surplus marketplace APIs, database sync."),
        ("partner-ops-bot", "Partner Ops Bot", "Merchant onboarding workflows and partner management."),
        ("qa-sim-bot", "QA & Simulation Bot", "Automated end-to-end integration testing.")]),
    "boardmint": ("Boardmint Compliance & Governance Crew", "lead-boardmint", [
        ("legal-compliance-bot", "Legal & Compliance Bot", "Statutory filings, corporate resolutions."),
        ("doc-archival-bot", "Document Archival Bot", "Contract indexing, vector search memory ingestion."),
        ("corp-secretary-bot", "Corporate Secretary Bot", "Board record maintenance and meeting logistics.")]),
    "rnd": ("R&D & Innovation Crew", "vp-tech-ops", [
        ("prototyping-bot", "Prototyping Bot", "Rapid concept validation and MVP construction."),
        ("tool-discovery-bot", "AI Tool Discovery & Benchmark Bot", "Framework evaluation and performance benchmarking."),
        ("algo-experiments-bot", "Algorithmic Experimentation Bot", "Experimental model testing and logic refinement.")]),
    "coreops": ("Central Operations (Core Ops)", "ceo-create-origins", [
        ("state-router-bot", "Fast Cache & State Router Bot", "System messaging and state persistence routing."),
        ("task-dispatcher-bot", "Task Dispatcher Bot", "Operational task queue distribution."),
        ("incident-response-bot", "Incident Response Bot", "Automated error handling, alerting, and failover management.")]),
    "people": ("Corporate Ops & People Ops Crew", "ceo-create-origins", [
        ("travelops-bot", "TravelOps Bot", "Corporate travel logistics and calendar coordination."),
        ("peopleops-bot", "PeopleOps Bot", "Talent acquisition and HR administration.")]),
    "personal": ("Personal Assistant Sub-Crew", "jasper", [
        ("pa-scheduler-bot", "Personal Assistant: Schedule", "Founder schedule and calendar coordination."),
        ("pa-research-bot", "Personal Assistant: Research", "Research tasks requested by the founder.")]),
}


def exec_by_slug(slug: str) -> Exec | None:
    return next((e for e in EXECUTIVES if e.slug == slug), None)


def route_executive(text: str) -> str:
    """Zero-token keyword pre-classifier: first executive whose keywords hit most; default is the Create Origins CEO."""
    t = text.lower()
    scores = {e.slug: sum(k in t for k in e.keywords) for e in EXECUTIVES}
    best = max(scores, key=lambda s: scores[s])
    return best if scores[best] > 0 else "ceo-create-origins"


def definitions() -> list[BotDef]:
    out = [BotDef(slug=e.slug, display_name=e.title.split(" / ")[0], role_title=e.title, crew="exec", reports_to="jasper",
                  prompt=(f"You are the {e.title} of Sir Jasper AI. {e.duty} You report to Sir Jasper. "
                          "When given a directive, state what your division will do, what you need from the founder, and any risks. Be concise."),
                  memory_namespace=f"exec.{e.slug}", lifecycle="active") for e in EXECUTIVES]
    for crew, (name, boss, members) in CREWS.items():
        for slug, title, duty in members:
            out.append(BotDef(slug=slug, display_name=title, role_title=title, crew=crew, reports_to=boss,
                              prompt=f"You are the {title} in the {name} of Sir Jasper AI. Your duty: {duty} Answer from that role only; say so if the request is outside it. Be concise.",
                              memory_namespace=f"bot.{slug}", lifecycle="probation"))
    return out


async def ensure_org() -> int:
    """Insert missing org bots (never overwrites existing rows the founder may have edited). Returns number created."""
    have = {r["slug"] for r in await aio.fetch("SELECT slug FROM shared.bot_definitions")}
    created = 0
    for d in definitions():
        if d.slug not in have:
            await registry.upsert(d)
            created += 1
    await registry.reload()
    return created
