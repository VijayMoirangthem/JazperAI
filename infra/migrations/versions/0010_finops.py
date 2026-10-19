"""FinOps ledger + budgets (Plan V2 F4)."""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE shared.llm_ledger(
      id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(), agent text NOT NULL, division text NOT NULL,
      provider text NOT NULL, model text NOT NULL, tier text, input_tokens int NOT NULL DEFAULT 0, output_tokens int NOT NULL DEFAULT 0,
      cache_read_tokens int NOT NULL DEFAULT 0, cache_write_tokens int NOT NULL DEFAULT 0, cost_usd numeric(12,6), latency_ms int)""")
    op.execute("CREATE INDEX llm_ledger_ts ON shared.llm_ledger (ts DESC)")
    op.execute("""CREATE TABLE shared.budgets(
      scope text PRIMARY KEY, daily_soft bigint, daily_hard bigint, per_request_hard bigint, updated_at timestamptz NOT NULL DEFAULT now())""")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared.budgets, shared.llm_ledger")
