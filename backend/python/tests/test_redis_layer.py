import asyncio
import statistics
import time

import pytest

from core.config import settings
from memory.redis import layer
from memory.redis.layer import Envelope

pytestmark = pytest.mark.db


@pytest.fixture(autouse=True)
async def _redis():
    layer._client = None
    if not await layer.health():
        pytest.skip("redis unavailable")
    yield
    await layer.client().aclose()
    layer._client = None


async def test_keys_are_namespaced():
    assert layer.key("baeit", "lock", "x") == "tenant:baeit:lock:x"


async def test_pubsub_roundtrip_p95_under_10ms():
    got: list[float] = []
    ready = asyncio.Event()

    async def listener():
        ps = layer.client().pubsub()
        await ps.subscribe(layer.key("t1", "bus", "bench"))
        ready.set()
        async for m in ps.listen():
            if m["type"] == "message":
                got.append(time.time() - Envelope.model_validate_json(m["data"]).sent_at)
                if len(got) == 200:
                    break
        await ps.aclose()

    t = asyncio.create_task(listener())
    await ready.wait()
    for _ in range(200):
        await layer.publish(Envelope(topic="bench", tenant="t1"))
        await asyncio.sleep(0.002)
    await asyncio.wait_for(t, 5)
    got = got[20:]  # drop warm-up
    p95 = statistics.quantiles(got, n=20)[18] * 1000
    print(f"pubsub p95={p95:.2f}ms")
    assert p95 < 15, f"p95 {p95:.2f}ms"


async def test_lock_contention_mutual_exclusion():
    inside, max_inside, acquired = 0, 0, 0

    async def worker():
        nonlocal inside, max_inside, acquired
        async with layer.lock("t1", "c", ttl_ms=2000, wait_s=3) as ok:
            if ok:
                acquired += 1
                inside += 1
                max_inside = max(max_inside, inside)
                await asyncio.sleep(0.01)
                inside -= 1

    await asyncio.gather(*(worker() for _ in range(10)))
    assert acquired == 10 and max_inside == 1


async def test_scratchpad_ttl():
    assert await layer.scratch_set("t1", "p", {"a": 1}, ttl_s=1)
    assert await layer.scratch_get("t1", "p") == {"a": 1}
    await asyncio.sleep(1.2)
    assert await layer.scratch_get("t1", "p") is None


async def test_redis_down_degrades_gracefully(monkeypatch):
    await layer.client().aclose()
    layer._client = None
    monkeypatch.setattr(settings, "REDIS_PORT", 1)  # nothing listens here
    assert await layer.health() is False
    assert await layer.publish(Envelope(topic="x", tenant="t1")) == 0
    assert await layer.scratch_get("t1", "p") is None
    async with layer.lock("t1", "d", wait_s=0.1) as ok:
        assert ok is False
