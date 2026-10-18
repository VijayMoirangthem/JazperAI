import asyncpg
import pytest

from core import audit
from core.config import settings
from tests.test_rls import dbname  # noqa: F401  (fixture: fresh migrated DB)

pytestmark = pytest.mark.db


async def _conn(db):
    return await asyncpg.connect(host=settings.POSTGRES_HOST, port=settings.POSTGRES_PORT, user=settings.POSTGRES_USER,
                                 password=settings.POSTGRES_PASSWORD, database=db)


async def test_chain_intact_then_tamper_detected_and_pii_redacted(dbname):  # noqa: F811
    c = await _conn(dbname)
    try:
        for i in range(5):  # noqa
            await audit.write("baeit", "task-update", {"n": i, "note": "PAN ABCDE1234F pw: hunter2hunter2"}, conn=c)
        ok, bad = await audit.verify(c)
        assert ok and bad is None
        assert await c.fetchval("SELECT count(*) FROM shared.audit_log WHERE tenant='baeit'") == 5
        stored = await c.fetchval("SELECT payload::text FROM shared.audit_log WHERE tenant='baeit' ORDER BY seq LIMIT 1")
        assert "ABCDE1234F" not in stored and "hunter2" not in stored
        # superuser tamper (REVOKE does not bind the owner) must be detected
        await c.execute("UPDATE shared.audit_log SET payload = '{\"n\": 99}'::jsonb WHERE seq = (SELECT seq FROM shared.audit_log WHERE tenant='baeit' ORDER BY seq OFFSET 2 LIMIT 1)")
        ok, bad = await audit.verify(c)
        assert not ok and bad is not None
    finally:
        await c.close()
