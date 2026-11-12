"""
Local sentence-transformers embeddings.
Uses all-MiniLM-L6-v2 (384-dim) — fast, private, no API dependency.
Model is downloaded once and cached in ~/.cache/huggingface.
"""
import structlog

log = structlog.get_logger()

EMBEDDING_DIM = 384
_MODEL_NAME = "all-MiniLM-L6-v2"
_model = None
_model_failed = False


import threading as _threading
import time as _time

_last_used = 0.0
_unload_lock = _threading.Lock()


def loaded_models() -> int:
    return int(_model is not None) + int(_mem_model is not None)


def trim_working_set() -> bool:
    """Python/torch keep freed memory inside the process, so deleting a model barely lowers RSS. On Windows, ask the OS to take back the
    pages this process is not using (EmptyWorkingSet): the freed model memory then becomes available to other programs. Pages still in
    use are simply faulted back in on demand. No-op elsewhere."""
    import sys
    if sys.platform != "win32":
        return False
    try:
        import ctypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.GetCurrentProcess.restype = ctypes.c_void_p      # a 64-bit pseudo-handle: the default int type would truncate it
        k32.K32EmptyWorkingSet.argtypes = [ctypes.c_void_p]
        k32.K32EmptyWorkingSet.restype = ctypes.c_int
        return bool(k32.K32EmptyWorkingSet(k32.GetCurrentProcess()))
    except Exception:
        return False


def unload(force: bool = False, idle_minutes: float = 10.0) -> dict:
    """Free the embedding models (about 1-2 GB of RAM) when idle for `idle_minutes` (or now with force=True). They reload on next use
    (one slow call). Returns what was freed. Never raises."""
    global _model, _mem_model
    import gc
    with _unload_lock:
        if not force and _time.monotonic() - _last_used < idle_minutes * 60:
            return {"unloaded": 0, "reason": "recently used"}
        n = loaded_models()
        _model = _mem_model = None
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    trimmed = trim_working_set()
    if n:
        log.info("embedding models unloaded to free RAM", count=n, trimmed=trimmed)
    return {"unloaded": n, "reason": "forced" if force else "idle", "working_set_trimmed": trimmed}


def _load():
    global _model, _model_failed, _last_used
    _last_used = _time.monotonic()
    if _model is not None:
        return _model
    if _model_failed:
        return None
    try:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(_MODEL_NAME)
        log.info("Embedding model loaded", model=_MODEL_NAME, dim=EMBEDDING_DIM)
        return _model
    except Exception as e:
        _model_failed = True
        log.warning("Embedding model failed to load — semantic memory disabled", error=str(e))
        return None


def embed(text: str) -> list[float] | None:
    """Embed text. Returns None if model not available."""
    m = _load()
    if m is None:
        return None
    try:
        vec = m.encode(text, normalize_embeddings=True)
        return vec.tolist()
    except Exception as e:
        log.warning("Embed failed", error=str(e))
        return None


def is_available() -> bool:
    return _load() is not None


# ── Unified-memory embeddings (D-5): pluggable provider, 1024-dim bge-m3-class ──────────────
MEMORY_EMBEDDING_DIM = 1024
_mem_model = None
_mem_failed = False


_mem_load_lock = _threading.Lock()
_warming = False
MIN_FREE_MB_TO_WARM = 2500  # the memory model needs about 2 GB; do not load it on a PC that is already short of RAM


def _load_memory_model():
    """Local provider (default). A cloud provider would be selected here via settings.EMBEDDING_PROVIDER (needs C-3)."""
    global _mem_model, _mem_failed, _last_used
    _last_used = _time.monotonic()
    if _mem_model is not None or _mem_failed:
        return _mem_model
    with _mem_load_lock:  # one loader at a time: a second caller waits instead of loading a second 2 GB copy
        if _mem_model is not None or _mem_failed:
            return _mem_model
        try:
            from sentence_transformers import SentenceTransformer
            from core.config import settings
            _mem_model = SentenceTransformer(settings.EMBEDDING_MODEL)
            log.info("Memory embedding model loaded", model=settings.EMBEDDING_MODEL)
        except Exception as e:
            _mem_failed = True
            log.warning("Memory embedding model unavailable", error=str(e))
    return _mem_model


def memory_model_ready() -> bool:
    return _mem_model is not None


def _free_mb() -> int:
    try:
        import psutil
        return int(psutil.virtual_memory().available / 1048576)
    except Exception:
        return 1 << 30  # cannot tell: assume there is room


def warm_memory_model_async(force: bool = False) -> bool:
    """Load the memory model in a background thread (about 25 s cold) so a chat never waits for it. Returns True if a load was started.
    Skipped when the PC is short of RAM (unless force): chat then simply answers without memory instead of slowing everything down."""
    global _warming
    if _mem_model is not None or _mem_failed or _warming:
        return False
    if not force and _free_mb() < MIN_FREE_MB_TO_WARM:
        return False
    _warming = True

    def run():
        global _warming
        try:
            _load_memory_model()
        finally:
            _warming = False

    _threading.Thread(target=run, daemon=True, name="memory-embedder-warmup").start()
    return True


def embed_memory(text: str) -> list[float] | None:
    """1024-dim embedding for shared.memory_chunks. Caller must sanitize `text` first. None if unavailable."""
    m = _load_memory_model()
    if m is None:
        return None
    try:
        return m.encode(text, normalize_embeddings=True).tolist()
    except Exception as e:
        log.warning("Memory embed failed", error=str(e))
        return None
