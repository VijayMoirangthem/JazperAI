"""Editable model prices (USD per 1M tokens). Rows are entered by the founder from official pricing pages."""
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE shared.model_prices(
      model text PRIMARY KEY, input_per_m numeric(12,4) NOT NULL, output_per_m numeric(12,4) NOT NULL,
      source text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now())""")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared.model_prices")
