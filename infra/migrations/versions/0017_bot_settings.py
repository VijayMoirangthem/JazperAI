"""Per-bot runtime settings (model pin, tier, temperature, max tokens, memory on/off) for every bot, built-in or dynamic."""
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE shared.bot_org ADD COLUMN settings jsonb NOT NULL DEFAULT '{}'")


def downgrade() -> None:
    op.execute("ALTER TABLE shared.bot_org DROP COLUMN settings")
