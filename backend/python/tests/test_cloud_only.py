"""Founder decision 2026-11-15: cloud models only. Nothing may load a model on this PC."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]

LOCAL_MODEL_IMPORTS = re.compile(r"^\s*(from|import)\s+(sentence_transformers|faster_whisper|transformers|torch|llama_cpp|ollama|spacy|presidio_analyzer)\b", re.M)


def test_no_python_module_imports_a_local_model_library():
    offenders = []
    for p in ROOT.rglob("*.py"):
        if any(part in (".venv", "tests", "__pycache__") for part in p.parts):
            continue
        if LOCAL_MODEL_IMPORTS.search(p.read_text(encoding="utf-8", errors="replace")):
            offenders.append(str(p.relative_to(ROOT)))
    assert offenders == [], f"these modules import a local model library: {offenders}"


def test_requirements_do_not_install_local_model_libraries():
    text = (REPO / "backend" / "python" / "requirements.txt").read_text(encoding="utf-8").lower() if (REPO / "backend" / "python" / "requirements.txt").exists() else ""
    if not text:
        text = (ROOT / "requirements.txt").read_text(encoding="utf-8").lower()
    for lib in ("faster-whisper", "sentence-transformers", "torch", "presidio", "spacy", "llama-cpp", "ollama"):
        assert lib not in text, lib


def test_defaults_point_at_the_cloud_and_never_at_lm_studio():
    from core.config import Settings
    s = Settings()
    assert s.LOCAL_FALLBACK_ENABLED is False and s.LOCAL_FALLBACK_URL == "" and s.EMBEDDING_PROVIDER == "cloud"


def test_the_ai_provider_creates_no_local_client_by_default(monkeypatch):
    from core.config import settings
    from core.providers import ai_provider
    monkeypatch.setattr(settings, "LOCAL_FALLBACK_ENABLED", False)
    monkeypatch.setattr(settings, "LOCAL_FALLBACK_URL", "")
    p = ai_provider.AIProvider() if hasattr(ai_provider, "AIProvider") else ai_provider.get_ai_provider()
    assert p._local_client is None
