"""Bot-to-bot communication log and the self-improving skill library (Hermes-style procedures)."""
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE shared.bot_messages(
          id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(),
          thread text NOT NULL, from_slug text NOT NULL, to_slug text NOT NULL,
          kind text NOT NULL DEFAULT 'message', text text NOT NULL DEFAULT '', meta jsonb NOT NULL DEFAULT '{}')"""
    )
    op.execute("CREATE INDEX ON shared.bot_messages (thread, id)")
    op.execute("CREATE INDEX ON shared.bot_messages (ts DESC)")
    op.execute(
        """CREATE TABLE shared.skills(
          name text PRIMARY KEY CHECK (name ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
          description text NOT NULL, body text NOT NULL, owner text NOT NULL DEFAULT 'shared',
          version int NOT NULL DEFAULT 1, uses int NOT NULL DEFAULT 0, wins int NOT NULL DEFAULT 0, losses int NOT NULL DEFAULT 0,
          created_by text NOT NULL DEFAULT 'founder', enabled boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz)"""
    )
    op.execute(
        """CREATE TABLE shared.skill_history(
          id bigserial PRIMARY KEY, name text NOT NULL, version int NOT NULL, body text NOT NULL, changed_by text NOT NULL,
          reason text NOT NULL DEFAULT '', ts timestamptz NOT NULL DEFAULT now())"""
    )


def downgrade() -> None:
    for t in ("skill_history", "skills", "bot_messages"):
        op.execute(f"DROP TABLE IF EXISTS shared.{t}")
