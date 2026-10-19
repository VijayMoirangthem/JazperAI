"""LLM provider / model / routing registry (Plan V2 A1)."""
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for stmt in [
        """CREATE TABLE shared.llm_providers(
          slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,40}$'),
          name text NOT NULL, kind text NOT NULL CHECK (kind IN ('openai_compat','anthropic','cli')),
          base_url text, secret_name text, secret_env text, enabled boolean NOT NULL DEFAULT true,
          local boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now())""",
        """CREATE TABLE shared.llm_models(
          provider text NOT NULL REFERENCES shared.llm_providers(slug) ON DELETE CASCADE,
          model_id text NOT NULL, label text, enabled boolean NOT NULL DEFAULT true, PRIMARY KEY (provider, model_id))""",
        # chain = ordered list of {"provider": slug, "model": model_id}
        """CREATE TABLE shared.llm_routing(
          tier text PRIMARY KEY CHECK (tier IN ('light','standard','frontier')), chain jsonb NOT NULL DEFAULT '[]')""",
    ]:
        op.execute(stmt)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared.llm_routing, shared.llm_models, shared.llm_providers")
