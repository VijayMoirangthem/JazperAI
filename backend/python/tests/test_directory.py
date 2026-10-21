from fastapi.testclient import TestClient

from core import directory


def test_seed_counts_and_lifecycles():
    bots = directory.bots()
    assert len({b.id for b in bots}) == len(bots)
    assert {b.lifecycle.value for b in bots} == {"active", "spec"}
    assert all(b.reports_to in {"founder", "jasper"} for b in bots)
    assert directory.humans()[0].employment == "founder"


def test_directory_endpoint_v1():
    from main import app
    r = TestClient(app, base_url="http://localhost").get("/api/v1/directory/")
    assert r.status_code == 200
    body = r.json()
    assert body["humans"] and body["bots"]
    assert body["bots"][0]["tenant_memberships"]
