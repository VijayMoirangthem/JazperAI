"""G4: Prometheus exposition and SLO error budgets."""
import pytest

from core import metrics


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(metrics, "PERSIST", False)
    metrics._req.clear(); metrics._hist.clear(); metrics._sum.clear(); metrics._minutes.clear()
    yield


def test_skip_health_and_ws():
    metrics.observe("GET", "/health/", 200, 0.01, "/health/")
    assert metrics.slo_status()["slos"][0]["events"] == 0


def test_availability_budget_breach():
    for _ in range(95):
        metrics.observe("GET", "/api/x", 200, 0.02, "/api/x")
    for _ in range(5):
        metrics.observe("GET", "/api/x", 500, 0.02, "/api/x")
    a = metrics.slo_status()["slos"][0]
    assert a["bad"] == 5 and a["status"] == "breached" and a["budget_remaining"] < 0  # 5 % errors vs 0.5 % allowed


def test_streaming_routes_excluded_from_latency_slo():
    metrics.observe("POST", "/api/v1/chat2/stream", 200, 20.0, "/api/v1/chat2/stream")
    metrics.observe("GET", "/api/x", 200, 0.01, "/api/x")
    lat = metrics.slo_status()["slos"][1]
    assert lat["events"] == 1 and lat["bad"] == 0


@pytest.mark.asyncio
async def test_render_histogram_is_cumulative():
    metrics.observe("GET", "/api/x", 200, 0.3, "/api/x")
    metrics.observe("GET", "/api/x", 200, 3.0, "/api/x")
    text = await metrics.render()
    assert 'jasper_http_request_duration_seconds_bucket{route="/api/x",le="0.5"} 1' in text
    assert 'jasper_http_request_duration_seconds_bucket{route="/api/x",le="+Inf"} 2' in text
    assert "jasper_slo_error_budget_remaining" in text
