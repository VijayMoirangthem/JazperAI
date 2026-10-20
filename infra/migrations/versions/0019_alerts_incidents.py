"""Alerts (open until resolved) and incident/RCA records with a failure taxonomy."""
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE shared.alerts(
          id bigserial PRIMARY KEY, key text NOT NULL, severity text NOT NULL, title text NOT NULL, detail text NOT NULL DEFAULT '',
          runbook text, created_at timestamptz NOT NULL DEFAULT now(), acked_at timestamptz, resolved_at timestamptz)"""
    )
    op.execute("CREATE INDEX ON shared.alerts (key) WHERE resolved_at IS NULL")
    op.execute(
        """CREATE TABLE shared.incidents(
          id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), source text NOT NULL, kind text NOT NULL,
          summary text NOT NULL, context jsonb NOT NULL DEFAULT '{}', runbook text)"""
    )
    op.execute("CREATE INDEX ON shared.incidents (ts DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared.incidents")
    op.execute("DROP TABLE IF EXISTS shared.alerts")
