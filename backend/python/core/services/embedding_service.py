"""Embeddings from a CLOUD API (founder decision 2026-11-15: no AI model runs on this PC).

Any OpenAI-compatible `POST {base}/embeddings` works (OpenAI, Gemini's OpenAI-compatible endpoint, Jina, Voyage, ...): configure
EMBEDDING_BASE_URL + EMBEDDING_MODEL and put the key in the vault as EMBEDDING_API_KEY. Two sizes are used:
  * embed()         384-dim, for the code index
  * embed_memory()  1024-dim, for shared.memory_chunks

SAFETY: stored memories were embedded by an earlier model (bge-m3), and vectors from different models cannot be compared. Memory recall and
storage therefore stay OFF until `scripts/memory_reembed.py` has re-embedded everything with the CURRENT provider/model and recorded that in
storage/state/memory_embedding.json. A configured key alone never switches memory on.

Nothing is loaded locally, so the old "unload / warm-up" functions remain only as harmless no-ops for the callers that still use them.
"""
from __future__ import annotations

import json
import threading as _threading
import time as _time
from collections import OrderedDict
from pathlib import Path

import structlog

log = structlog.get_logger()

EMBEDDING_DIM = 384            # code index
MEMORY_EMBEDDING_DIM = 1024    # shared.memory_chunks.embedding is vector(1024)
TIMEOUT_S = 8.0
STATE_FILE = Path(__file__).resolve().parents[3] / "storage" / "state" / "memory_embedding.json"

_transport = None              # tests inject an httpx.MockTransport here
_cache: "OrderedDict[tuple, list[float]]" = OrderedDict()
_cache_lock = _threading.Lock()
CACHE_MAX = 256


# ── configuration ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

def _settings():
    from core.config import settings
    return settings


def _api_key() -> str:
    try:
        from core import vault
        k = vault.get("EMBEDDING_API_KEY")
        if k:
            return k
    except Exception:  # noqa: BLE001 - vault unavailable: fall back to the environment
        pass
    return _settings().EMBEDDING_API_KEY or ""


def configured() -> bool:
    s = _settings()
    return s.EMBEDDING_PROVIDER == "cloud" and bool(s.EMBEDDING_BASE_URL and s.EMBEDDING_MODEL and _api_key())


def space_id() -> str:
    """Names the embedding space of the CURRENT configuration (provider endpoint + model + size)."""
    s = _settings()
    return f"{s.EMBEDDING_BASE_URL.rstrip('/')}|{s.EMBEDDING_MODEL}|{MEMORY_EMBEDDING_DIM}"


def memory_space_ok() -> bool:
    """True only when stored memories have been re-embedded with the current provider/model (see scripts/memory_reembed.py)."""
    try:
        return configured() and json.loads(STATE_FILE.read_text(encoding="utf-8")).get("space") == space_id()
    except (OSError, ValueError):
        return False


def record_memory_space() -> None:
    """Written by scripts/memory_reembed.py after a COMPLETE re-embedding."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"space": space_id(), "at": _time.strftime("%Y-%m-%d %H:%M:%S")}), encoding="utf-8")


# ── the API call ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def _call(inputs: list[str], dim: int) -> list[list[float]] | None:
    """One embeddings request (one retry on rate limit / server error). None on any failure; the caller degrades gracefully."""
    import httpx
    from core import health_stats
    s = _settings()
    body = {"model": s.EMBEDDING_MODEL, "input": inputs, "dimensions": dim, "encoding_format": "float"}
    headers = {"Authorization": f"Bearer {_api_key()}", "Content-Type": "application/json"}
    url = s.EMBEDDING_BASE_URL.rstrip("/") + "/embeddings"
    last = ""
    for attempt in range(2):
        try:
            with httpx.Client(timeout=TIMEOUT_S, transport=_transport) as c:
                r = c.post(url, json=body, headers=headers)
            if r.status_code == 200:
                data = sorted(r.json()["data"], key=lambda d: d.get("index", 0))
                vecs = [d["embedding"] for d in data]
                if len(vecs) != len(inputs) or any(len(v) != dim for v in vecs):
                    last = f"provider returned {len(vecs[0]) if vecs else 0}-dim vectors, expected {dim} (does the model support `dimensions`?)"
                    break
                health_stats.record("embed", True)
                return vecs
            last = f"HTTP {r.status_code}: {r.text[:120]}"
            if r.status_code not in (429, 500, 502, 503, 504):
                break
        except Exception as e:  # noqa: BLE001 - network problem, timeout, bad JSON
            last = f"{type(e).__name__}: {str(e)[:100]}"
        _time.sleep(0.4 * (attempt + 1))
    health_stats.record("embed", False, last)
    log.warning("cloud embedding failed", error=last)
    return None


def _embed(text: str, dim: int) -> list[float] | None:
    text = (text or "").strip()
    if not text or not configured():
        return None
    key = (space_id(), dim, text)
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    out = _call([text[:8000]], dim)
    if not out:
        return None
    with _cache_lock:
        _cache[key] = out[0]
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)
    return out[0]


def embed(text: str) -> list[float] | None:
    """384-dim embedding (code index). None when no cloud provider is configured or it failed."""
    return _embed(text, EMBEDDING_DIM)


def is_available() -> bool:
    return configured()


def embed_memory(text: str, force: bool = False) -> list[float] | None:
    """1024-dim embedding for shared.memory_chunks. Caller must sanitize `text` first. None unless the memory space is verified
    (`force=True` is for the re-embedding script only)."""
    if not force and not memory_space_ok():
        return None
    return _embed(text, MEMORY_EMBEDDING_DIM)


def embed_memory_many(texts: list[str], batch: int = 32) -> list[list[float] | None]:
    """Re-embedding helper (force): one request per `batch` texts. A failed batch yields None for its items."""
    out: list[list[float] | None] = []
    for i in range(0, len(texts), batch):
        chunk = [t[:8000] for t in texts[i:i + batch]]
        vecs = _call(chunk, MEMORY_EMBEDDING_DIM) if configured() else None
        out.extend(vecs if vecs else [None] * len(chunk))
    return out


# ── compatibility for callers written for the old local models (nothing is loaded locally any more) ────────────────────────────

def memory_model_ready() -> bool:
    """Recall may run: a cloud provider is configured AND memories are in its embedding space."""
    return memory_space_ok()


def warm_memory_model_async(force: bool = False) -> bool:
    return False


def loaded_models() -> int:
    return 0


def trim_working_set() -> bool:
    return False


def unload(force: bool = False, idle_minutes: float = 10.0) -> dict:
    return {"unloaded": 0, "reason": "cloud embeddings: no model is loaded on this PC"}
