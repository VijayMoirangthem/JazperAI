"""Resource-aware execution: persisted performance settings + agent activation overlay.

shared.perf_settings   one JSON document per key ('main') so every performance setting survives a restart.
shared.agent_activation  per-agent on/off overlay for ANY agent (built-in or DB-defined). No row = active, so nothing changes
                         until you switch an agent off. Deactivating never deletes the agent, its settings or its data.
"""
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE IF NOT EXISTS shared.perf_settings(
        key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())""")
    op.execute("""CREATE TABLE IF NOT EXISTS shared.agent_activation(
        slug text PRIMARY KEY, active boolean NOT NULL, reason text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now())""")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared.agent_activation")
    op.execute("DROP TABLE IF EXISTS shared.perf_settings")
