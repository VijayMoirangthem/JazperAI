import statistics
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import core.eventbus as eb
from core.eventbus import EventBus


def asc(to="working", **kw):
    return {"topic": "agent-state-change", "agent_id": str(uuid4()), "agent_slug": "a.b", "to_state": to, **kw}


def test_schema_validation_per_topic():
    b = EventBus()
    with pytest.raises(ValidationError):
        b.publish(asc(to="nonsense"))
    with pytest.raises(ValidationError):
        b.publish({"topic": "diff-stream", "stream_id": str(uuid4()), "path": "x", "branch": "main",
                   "base_sha": "abc1234", "op": "begin", "chunk_index": 0})  # branch must be agent-patch/*
    with pytest.raises(ValidationError):
        b.publish(asc(attempt=4))
    b.publish({"topic": "execution-log", "run_id": str(uuid4()), "line": "hi"})
    b.publish({"topic": "human-intervention-request", "request_id": str(uuid4()), "tier": 3,
               "action": "git.merge_main", "summary": "s"})


async def test_ordering_replay_and_backpressure():
    b = EventBus()
    for _ in range(5):
        b.publish(asc())
    s = b.subscribe({"agent-state-change"}, since={"agent-state-change": 2})
    assert [s.q.get_nowait().seq for _ in range(3)] == [3, 4, 5]
    b.publish(asc())
    assert s.q.get_nowait().seq == 6
    slow = b.subscribe({"agent-state-change"})
    for _ in range(eb.QUEUE + 1):
        b.publish(asc())
    assert slow.dropped and slow not in b._subs


async def test_publish_to_subscriber_latency_p95_under_100ms():
    b = EventBus()
    s = b.subscribe({"agent-state-change"})
    lat = []
    for _ in range(300):
        t = time.perf_counter()
        b.publish(asc())
        await s.q.get()
        lat.append((time.perf_counter() - t) * 1000)
    p95 = statistics.quantiles(lat, n=20)[18]
    print(f"bus p95={p95:.3f}ms")
    assert p95 < 100


def test_rpc_websocket_subscribe_and_errors():
    from core.eventbus import bus
    from main import app
    with TestClient(app, base_url="http://localhost").websocket_connect("/ws/rpc", headers={"host": "localhost"}) as ws:
        ws.send_json({"jsonrpc": "2.0", "id": 1, "method": "subscribe", "params": {"topics": ["bogus"]}})
        assert ws.receive_json()["error"]["code"] == -32602
        ws.send_json({"jsonrpc": "2.0", "id": 2, "method": "subscribe", "params": {"topics": ["agent-state-change"]}})
        assert ws.receive_json()["result"]["subscribed"] == ["agent-state-change"]
        bus.publish(asc(status_bubble="hello"))
        m = ws.receive_json()
        assert m["method"] == "agent-state-change" and m["params"]["status_bubble"] == "hello" and m["seq"] >= 1
        ws.send_json({"jsonrpc": "2.0", "id": 3, "method": "nope"})
        assert ws.receive_json()["error"]["code"] == -32601
