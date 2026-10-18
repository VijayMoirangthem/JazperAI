"""Directory, tenant-scoped tables, RLS (ENABLE+FORCE), app_runtime role, hash-chained audit_log (spec §11/§16/§25)."""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

TENANT_TABLES = ["shared.memberships", "shared.memory_chunks", "shared.audit_log"]
_TENANTS = "string_to_array(current_setting('app.tenants', true), ',')"


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute(
        "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime') "
        "THEN CREATE ROLE app_runtime NOLOGIN; END IF; END $$"
    )
    for stmt in [
        """CREATE TABLE shared.principals(
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK (kind IN ('human','bot')),
          display_name text NOT NULL, attrs jsonb NOT NULL DEFAULT '{}', presence text NOT NULL DEFAULT 'offline',
          created_at timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz)""",
        "CREATE TABLE shared.roles(name text PRIMARY KEY)",
        """CREATE TABLE shared.permissions(
          role text NOT NULL REFERENCES shared.roles(name), permission text NOT NULL, PRIMARY KEY(role, permission))""",
        """CREATE TABLE shared.memberships(
          principal_id uuid NOT NULL REFERENCES shared.principals(id), tenant text NOT NULL,
          roles text[] NOT NULL DEFAULT '{}', scopes text[] NOT NULL DEFAULT '{}', PRIMARY KEY(principal_id, tenant))""",
        """CREATE TABLE shared.memory_chunks(
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant text NOT NULL, namespace text NOT NULL, principal_id uuid,
          content text NOT NULL, pii_redacted boolean NOT NULL DEFAULT true, embedding vector(1024),
          created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz)""",
        "CREATE INDEX ON shared.memory_chunks USING hnsw (embedding vector_cosine_ops)",
        # entry_hash is filled by the BEFORE INSERT trigger below
        """CREATE TABLE shared.audit_log(
          seq bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), tenant text NOT NULL, trace_id uuid,
          principal_id uuid, topic text, payload jsonb, prev_hash bytea, entry_hash bytea)""",
        """CREATE FUNCTION shared.audit_chain() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
           SET search_path = shared, public AS $f$
        DECLARE p bytea;
        BEGIN
          PERFORM pg_advisory_xact_lock(727001);
          SELECT entry_hash INTO p FROM shared.audit_log ORDER BY seq DESC LIMIT 1;
          NEW.prev_hash := p;
          NEW.entry_hash := digest(coalesce(p, ''::bytea) || convert_to(
            NEW.ts::text || NEW.tenant || coalesce(NEW.topic, '') || coalesce(NEW.payload::text, ''), 'UTF8'), 'sha256');
          RETURN NEW;
        END $f$""",
        "CREATE TRIGGER audit_chain BEFORE INSERT ON shared.audit_log FOR EACH ROW EXECUTE FUNCTION shared.audit_chain()",
    ]:
        op.execute(stmt)
    for t in TENANT_TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {t} USING (tenant = ANY ({_TENANTS})) "
            f"WITH CHECK (tenant = ANY ({_TENANTS}))"
        )
    for stmt in [
        "GRANT USAGE ON SCHEMA shared TO app_runtime",
        "GRANT SELECT, INSERT, UPDATE, DELETE ON shared.principals, shared.roles, shared.permissions, "
        "shared.memberships, shared.memory_chunks TO app_runtime",
        "GRANT SELECT, INSERT ON shared.audit_log TO app_runtime",
        "GRANT USAGE ON SEQUENCE shared.audit_log_seq_seq TO app_runtime",
        "REVOKE UPDATE, DELETE, TRUNCATE ON shared.audit_log FROM PUBLIC, app_runtime",
    ]:
        op.execute(stmt)


def downgrade() -> None:
    op.execute(
        "DROP TABLE IF EXISTS shared.audit_log, shared.memory_chunks, shared.memberships, "
        "shared.permissions, shared.roles, shared.principals CASCADE"
    )
    op.execute("DROP FUNCTION IF EXISTS shared.audit_chain()")
