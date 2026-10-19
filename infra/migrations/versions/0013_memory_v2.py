"""Memory v2 columns (Plan V2 G2): importance, usage for forgetting, supersession chain for updates."""
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE shared.memory_chunks ADD COLUMN importance real NOT NULL DEFAULT 0.5, ADD COLUMN hits int NOT NULL DEFAULT 0, "
               "ADD COLUMN last_used_at timestamptz, ADD COLUMN superseded_by uuid")


def downgrade() -> None:
    op.execute("ALTER TABLE shared.memory_chunks DROP COLUMN importance, DROP COLUMN hits, DROP COLUMN last_used_at, DROP COLUMN superseded_by")
