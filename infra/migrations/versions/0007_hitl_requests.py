"""Persisted human-in-the-loop requests (P2-07)."""
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE shared.hitl_requests(
          request_id uuid PRIMARY KEY, tier int NOT NULL, action text NOT NULL, summary text NOT NULL,
          requester text NOT NULL, approvers jsonb NOT NULL DEFAULT '[]',
          status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','auto')),
          decided_by text, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
          expires_at timestamptz NOT NULL)"""
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared.hitl_requests")
