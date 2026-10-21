import pytest
from fastapi.testclient import TestClient

from agents import org
from agents.exec_graph import run_directive


def test_spec_structure_is_complete():
    assert [e.slug for e in org.EXECUTIVES[:4]] == ["ceo-create-origins", "ceo-baeit", "lead-boardmint", "vp-tech-ops"]
    assert set(org.CREWS) == {"it", "baeit", "boardmint", "rnd", "coreops", "people", "personal"}
    assert sum(len(v[2]) for k, v in org.CREWS.items() if k not in ("people", "personal")) == 16  # spec-listed bots
    slugs = [d.slug for d in org.definitions()]
    assert len(slugs) == len(set(slugs))


def test_executive_routing_keywords():
    assert org.route_executive("Ship the Baeit merchant onboarding") == "ceo-baeit"
    assert org.route_executive("Prepare the statutory filing for the board") == "lead-boardmint"
    assert org.route_executive("Our database server needs a deploy") == "vp-tech-ops"
    assert org.route_executive("hello there") == "ceo-create-origins"


@pytest.mark.db
async def test_each_executive_returns_structured_report_with_trace_ids():
    from agents.registry import registry
    from memory.db import aio
    await org.ensure_org()
    await registry.reload()

    async def ask(slug, text):
        return f"{slug} says ok"

    seen_spans = set()
    for e in org.EXECUTIVES[:4]:
        rep = await run_directive("status update please", e.slug, ask=ask)
        assert rep["executive"] == e.slug and rep["status"] == "complete" and rep["summary"] == f"{e.slug} says ok"
        t = rep["trace"]
        assert len(t["trace_id"]) == 32 and t["exec_span"] not in seen_spans
        seen_spans.add(t["exec_span"])
        assert all(sp["parent_id"] == t["exec_span"] for sp in t["member_spans"])
        assert rep["crew"], e.slug  # members of its crews took part
    # a failing member degrades the report instead of failing it
    async def flaky(slug, text):
        if slug.endswith("-bot"):
            raise RuntimeError("boom")
        return "fine"
    part = await run_directive("status", "ceo-baeit", ask=flaky)
    assert part["status"] == "partial" and part["summary"] == "fine"
    await aio.close_pool()


@pytest.mark.db
def test_company_api(monkeypatch):
    from main import app
    c = TestClient(app, base_url="http://localhost")
    s = c.get("/api/v1/company/structure").json()
    assert len(s["executives"]) == 7 and "baeit" in s["crews"]
    assert c.post("/api/v1/company/directive", json={"text": "x", "executive": "nope"}).status_code == 404
