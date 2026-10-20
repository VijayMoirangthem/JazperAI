"""Workspaces: folders on this PC that a group's bots may work in (read by default, writes gated)."""
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """CREATE TABLE shared.workspaces(
          id serial PRIMARY KEY, org_group text NOT NULL, path text NOT NULL, label text NOT NULL DEFAULT '',
          mode text NOT NULL DEFAULT 'read-write' CHECK (mode IN ('read','read-write')),
          created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (org_group, path))"""
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared.workspaces")
