"""Hot-pluggable agent definitions (P2-01)."""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE shared.bot_definitions(
          slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9._-]{1,62}$'),
          display_name text NOT NULL, role_title text NOT NULL, crew text NOT NULL,
          reports_to text NOT NULL DEFAULT 'jasper', prompt text NOT NULL,
          tools jsonb NOT NULL DEFAULT '[]', model_policy jsonb NOT NULL DEFAULT '{"default_tier":"standard"}',
          memory_namespace text NOT NULL, lifecycle text NOT NULL DEFAULT 'probation',
          enabled boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())"""
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared.bot_definitions")
