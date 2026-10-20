"""Immutable evaluation ledger for bots: interviews, benchmarks, clearance decisions, performance-improvement plans (spec sections 18-19)."""
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE shared.bot_evaluations(
          id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), slug text NOT NULL, kind text NOT NULL,
          score numeric, passed boolean, detail jsonb NOT NULL DEFAULT '{}', by text NOT NULL DEFAULT 'lifecycle')"""
    )
    op.execute("CREATE INDEX ON shared.bot_evaluations (slug, id DESC)")
    # append-only: history is evidence, never edited
    op.execute("CREATE RULE bot_evaluations_no_update AS ON UPDATE TO shared.bot_evaluations DO INSTEAD NOTHING")
    op.execute("CREATE RULE bot_evaluations_no_delete AS ON DELETE TO shared.bot_evaluations DO INSTEAD NOTHING")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared.bot_evaluations")
