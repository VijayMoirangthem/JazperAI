import pytest

from memory.sanitizer import sanitize

SEEDS = {
    "AADHAAR": "my aadhaar is 2345 6789 0124",  # Verhoeff-valid
    "PAN": "PAN ABCDE1234F for tax",
    "CARD": "card 4111 1111 1111 1111 expires soon",  # Luhn-valid test number
    "UPI_ID": "pay me at rahul.k@okaxis please",
    "API_KEY": "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123",
    "PASSWORD": "password: hunter2hunter2",
    "EMAIL_ADDRESS": "mail vijay@example.com now",
}
RAW = {"2345 6789 0124", "ABCDE1234F", "4111 1111 1111 1111", "rahul.k@okaxis",
       "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123", "hunter2hunter2", "vijay@example.com"}


def _verhoeff_valid_sample():
    from memory.sanitizer import _verhoeff
    for n in range(234567890120, 234567890200):
        if _verhoeff(str(n)):
            return str(n)


def test_seeded_pii_and_secrets_removed():
    aadhaar = _verhoeff_valid_sample()
    seeds = dict(SEEDS, AADHAAR=f"my aadhaar is {aadhaar}")
    raw = (RAW - {"2345 6789 0124"}) | {aadhaar}
    for entity, text in seeds.items():
        clean, found = sanitize(text)
        assert entity in found, (entity, clean)
        assert not any(r in clean for r in raw), clean


def test_invalid_checksums_not_redacted_and_plain_text_untouched():
    assert sanitize("order 1234 5678 9012 shipped")[1] == []  # fails Verhoeff
    assert sanitize("I like hiking in Manipur")[0] == "I like hiking in Manipur"


@pytest.mark.db
async def test_memory_roundtrip_stores_only_clean_text():
    from core.services import embedding_service
    from core.services.memory_service import memory_service
    from memory.db import aio
    if embedding_service.embed_memory("warmup") is None:
        pytest.skip("memory embedder unavailable")
    await memory_service.store_extracted("User lives in Imphal; PAN ABCDE1234F; password: hunter2hunter2", "t-sess")
    rows = await aio.fetch("SELECT content FROM shared.memory_chunks WHERE namespace='extracted'")
    legacy = await aio.fetch("SELECT content FROM extracted_memories WHERE session_id='t-sess'")
    assert rows and legacy
    assert not any("ABCDE1234F" in r["content"] or "hunter2" in r["content"] for r in (*rows, *legacy))
    hits = await memory_service.search_memories("Where does the user live? Imphal", top_k=3)
    assert any("Imphal" in h for h in hits)
    await aio.execute("DELETE FROM extracted_memories WHERE session_id='t-sess'")
    await aio.execute("DELETE FROM shared.memory_chunks WHERE content LIKE 'User lives in Imphal%'")
    await aio.close_pool()
