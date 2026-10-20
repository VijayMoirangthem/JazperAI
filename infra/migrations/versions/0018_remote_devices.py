"""Paired remote devices (phone app). The device secret is stored only as a hash."""
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE shared.devices(
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, platform text NOT NULL DEFAULT '',
          secret_hash text NOT NULL, push_token text, revoked boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(), last_seen timestamptz, last_ip text)"""
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared.devices")
