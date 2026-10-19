"""Decision model for group rooms (pattern: OpenMausBot docs/decision-model.md): @mentions win; otherwise a fast
light-tier call picks who answers, with a confidence threshold and a deterministic fallback to the room lead."""
import json
import re

from core.llm.types import LLMRequest

THRESHOLD = 0.6
_MENTION = re.compile(r"@([a-z0-9][a-z0-9._-]{1,62})")


def mentions(text: str, members: list[str]) -> list[str]:
    return [m for m in dict.fromkeys(_MENTION.findall(text.lower())) if m in members]


async def decide(router, text: str, members: list[dict], lead: str = "jasper") -> dict:
    """members: [{slug, role_title}]. Returns {"slugs": [...], "source": "mention|model|fallback", "confidence": float}."""
    slugs = [m["slug"] for m in members]
    picked = mentions(text, slugs)
    if picked:
        return {"slugs": picked, "source": "mention", "confidence": 1.0}
    roster = "\n".join(f"- {m['slug']}: {m.get('role_title', '')}" for m in members)
    try:
        res = await router.complete(LLMRequest(
            system=("You route a message in a company chat room to the best responder(s). "
                    'Reply with JSON only: {"slugs": ["slug"], "confidence": 0.0-1.0}. Pick at most 2 slugs from the list.\n' + roster),
            messages=[{"role": "user", "content": text[:1500]}], tier="light", max_tokens=80))
        data = json.loads(re.search(r"\{.*\}", res.text, re.S).group(0))
        chosen = [s for s in data.get("slugs", []) if s in slugs][:2]
        conf = float(data.get("confidence", 0))
        if chosen and conf >= THRESHOLD:
            return {"slugs": chosen, "source": "model", "confidence": conf}
    except Exception:
        pass
    return {"slugs": [lead if lead in slugs else slugs[0]], "source": "fallback", "confidence": 0.0}
