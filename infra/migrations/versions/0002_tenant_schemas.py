"""Create tenant schemas (D-17). Data migration of business_* tables is deferred."""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

SCHEMAS = ("co", "baeit", "boardmint", "shared")


def upgrade() -> None:
    for s in SCHEMAS:
        op.execute(f"CREATE SCHEMA IF NOT EXISTS {s}")


def downgrade() -> None:
    for s in reversed(SCHEMAS):
        op.execute(f"DROP SCHEMA IF EXISTS {s}")
