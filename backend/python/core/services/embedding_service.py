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


def _load():
    global _model, _model_failed
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


def _load_memory_model():
    """Local provider (default). A cloud provider would be selected here via settings.EMBEDDING_PROVIDER (needs C-3)."""
    global _mem_model, _mem_failed
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
