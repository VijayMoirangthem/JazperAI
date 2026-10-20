"""Group discussions: the bots of one group/organisation talk a topic through, then the group's lead states a conclusion.

Pattern: CrewAI's manager-led process (a lead synthesises the crew's work) and generative_agents' multi-party conversation (each speaker sees the
transcript so far). Rounds are sequential so later speakers can agree, disagree or build on earlier ones. Every turn is stored in the comms log
(thread "meeting|<group>") so the exchange can be replayed. Yields chat2-compatible events (speaker/delta/done) plus {"t":"phase"} markers.
"""
from collections.abc import AsyncIterator

from agents import comms, orgchart
from core import finops
from core.llm.types import LLMRequest, Usage

MAX_MEMBERS = 5
LEADS = {"create_origins": "ceo-create-origins", "baeit": "ceo-baeit", "boardmint": "lead-boardmint", "jazper_team": "jasper"}

TURN_RULE = ("You are in a short team meeting. Give your view on the topic in at most 60 words from your role's perspective. Build on, agree with or challenge what was "
             "said before; do not repeat it. Be concrete (a risk, a number, a step). No greetings.")
CONCLUDE_RULE = ("You lead this meeting. Close it. Write: Decision (one sentence), Why (one or two lines, reflecting the strongest points and any dissent), "
                 "Action items (owner - task), Open question (if any). Max 120 words.")


async def members_of(group: str) -> list[dict]:
    for g in (await orgchart.tree())["groups"]:
        if g["id"] == group:
            return [b for b in g["bots"] if b["enabled"] and b["source"] != "spec"][:MAX_MEMBERS + 1]
    return []


async def stream(router, group: str, topic: str, rounds: int = 2) -> AsyncIterator[dict]:
    from api.routes.chat2 import _persona

    members = await members_of(group)
    lead_slug = LEADS.get(group, "jasper")
    if not members:
        yield {"t": "error", "message": f"no active bots in group {group}"}
        return
    speakers = [m for m in members if m["slug"] != lead_slug][:MAX_MEMBERS] or members[:1]
    yield {"t": "phase", "text": f"Meeting: {topic[:120]} — {', '.join(m['display_name'] for m in speakers)}; lead {lead_slug}"}
    transcript: list[str] = []

    async def turn(slug: str, rule: str, task: str, label: str) -> AsyncIterator[dict]:
        system, tier = _persona(slug)
        yield {"t": "speaker", "slug": slug}
        buf = ""
        with finops.attribute(slug, group):
            async for item in router.stream(LLMRequest(system=f"{system}\n\n{rule}", messages=[{"role": "user", "content": task}], tier="standard", max_tokens=260, temperature=0.6)):
                if isinstance(item, Usage):
                    yield {"t": "done", "slug": slug, "usage": item.model_dump()}
                else:
                    buf += item
                    yield {"t": "delta", "slug": slug, "text": item}
        transcript.append(f"{slug}: {buf.strip()}")
        await comms.log(slug, f"meeting:{group}", label, buf.strip())
        await orgchart.record_call(slug, bool(buf.strip()))

    await comms.log("founder", f"meeting:{group}", "ask", topic)
    for rnd in range(1, rounds + 1):
        yield {"t": "phase", "text": f"Round {rnd}"}
        for m in speakers:
            task = f"Topic: {topic}\n\nSo far:\n" + ("\n".join(transcript) or "(you speak first)")
            async for ev in turn(m["slug"], TURN_RULE, task, "message"):
                yield ev
    yield {"t": "phase", "text": "Conclusion"}
    async for ev in turn(lead_slug, CONCLUDE_RULE, f"Topic: {topic}\n\nDiscussion:\n" + "\n".join(transcript), "conclusion"):
        yield ev
