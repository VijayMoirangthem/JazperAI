"""RLS negative tests against a real pgvector Postgres (infra compose). Skipped if unreachable."""
import os
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import quote_plus

import psycopg2
import psycopg2.errors
import pytest

from core.config import settings
from core.tenancy import RequestContext, apply_context

pytestmark = pytest.mark.db
ROOT = Path(__file__).resolve().parents[1]
DB = "t_" + uuid.uuid4().hex[:8]


def _conn(db):
    return psycopg2.connect(host=settings.POSTGRES_HOST, port=settings.POSTGRES_PORT, user=settings.POSTGRES_USER,
                            password=settings.POSTGRES_PASSWORD, dbname=db)


@pytest.fixture(scope="module")
def dbname():
    try:
        c = _conn("postgres")
    except Exception:
        pytest.skip("postgres unavailable")
    c.autocommit = True
    c.cursor().execute(f"CREATE DATABASE {DB}")
    url = (f"postgresql+psycopg2://{settings.POSTGRES_USER}:{quote_plus(settings.POSTGRES_PASSWORD)}"
           f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{DB}")
    r = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=ROOT,
                       env={**os.environ, "ALEMBIC_DATABASE_URL": url}, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-800:]
    _seed(DB)
    yield DB
    c.cursor().execute(f"DROP DATABASE {DB} WITH (FORCE)")


def _as(db, tenants):
    c = _conn(db)
    cur = c.cursor()
    apply_context(cur, RequestContext("p1", tuple(tenants)))
    return c, cur


def _seed(db):
    c = _conn(db)
    cur = c.cursor()
    for tenant in ("A", "B"):
        cur.execute("INSERT INTO shared.principals(kind, display_name) VALUES ('human','h') RETURNING id")
        cur.execute("INSERT INTO shared.memberships(principal_id, tenant) VALUES (%s,%s)", (cur.fetchone()[0], tenant))
        cur.execute("INSERT INTO shared.memory_chunks(tenant, namespace, content) VALUES (%s,'n','c')", (tenant,))
        cur.execute("INSERT INTO shared.audit_log(tenant, topic) VALUES (%s,'t')", (tenant,))
    c.commit()
    c.close()


INSERTS = {
    "shared.memberships": "INSERT INTO shared.memberships(principal_id, tenant) "
                          "SELECT gen_random_uuid(), 'B'",
    "shared.memory_chunks": "INSERT INTO shared.memory_chunks(tenant, namespace, content) VALUES ('B','n','c')",
    "shared.audit_log": "INSERT INTO shared.audit_log(tenant, topic) VALUES ('B','t')",
}


@pytest.mark.parametrize("table", list(INSERTS))
def test_select_and_insert_isolated(dbname, table):
    c, cur = _as(dbname, ["A"])
    cur.execute(f"SELECT tenant FROM {table}")
    assert {r[0] for r in cur.fetchall()} == {"A"}
    with pytest.raises(psycopg2.Error):
        cur.execute(INSERTS[table])
    c.close()


@pytest.mark.parametrize("table", ["shared.memberships", "shared.memory_chunks"])
def test_update_delete_other_tenant_noop(dbname, table):
    c, cur = _as(dbname, ["A"])
    cur.execute(f"UPDATE {table} SET tenant = tenant WHERE tenant = 'B'")
    assert cur.rowcount == 0
    cur.execute(f"DELETE FROM {table} WHERE tenant = 'B'")
    assert cur.rowcount == 0
    c.close()


@pytest.mark.parametrize("table", list(INSERTS))
def test_missing_guc_zero_rows(dbname, table):
    c = _conn(dbname)
    cur = c.cursor()
    cur.execute("SET LOCAL ROLE app_runtime")
    cur.execute(f"SELECT count(*) FROM {table}")
    assert cur.fetchone()[0] == 0
    c.close()


def test_app_runtime_is_not_superuser_nor_bypassrls(dbname):
    c = _conn(dbname)
    cur = c.cursor()
    cur.execute("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='app_runtime'")
    assert cur.fetchone() == (False, False)
    c.close()


def test_audit_log_immutable_and_chained(dbname):
    c, cur = _as(dbname, ["A"])
    for stmt in ("UPDATE shared.audit_log SET topic='x'", "DELETE FROM shared.audit_log", "TRUNCATE shared.audit_log"):
        with pytest.raises(psycopg2.errors.InsufficientPrivilege):
            cur.execute(stmt)
        c.rollback()
        apply_context(cur, RequestContext("p1", ("A",)))
    cur.execute("SELECT entry_hash IS NOT NULL FROM shared.audit_log")
    rows = cur.fetchall()
    assert rows and all(r[0] for r in rows)
    c.close()
