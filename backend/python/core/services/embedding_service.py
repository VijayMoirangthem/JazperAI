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
