"""MCP connector manifests (Plan V2 F3). Credentials are never stored here: env_secrets maps ENV_VAR -> vault entry name."""
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE shared.mcp_connectors(
      id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_-]{1,40}$'), name text NOT NULL, command jsonb NOT NULL,
      env_secrets jsonb NOT NULL DEFAULT '{}', tool_tiers jsonb NOT NULL DEFAULT '{}', rate_per_min int NOT NULL DEFAULT 60,
      enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())""")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared.mcp_connectors")
