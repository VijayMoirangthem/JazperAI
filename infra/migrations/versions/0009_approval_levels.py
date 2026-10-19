"""Per-bot approval levels (Plan V2 C5)."""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE shared.approval_levels(
      slug text PRIMARY KEY, level text NOT NULL CHECK (level IN ('ask','auto_edits','approve_for_me','full')),
      updated_at timestamptz NOT NULL DEFAULT now())""")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared.approval_levels")
