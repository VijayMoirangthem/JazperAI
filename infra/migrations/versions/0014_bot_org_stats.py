"""Bot organisation overlay (group / department / position / order / prompt override) and per-bot performance stats."""
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # overlay keyed by slug so built-in persona bots (defined in code) and dynamic bots are organised the same way
    op.execute(
        """CREATE TABLE shared.bot_org(
          slug text PRIMARY KEY,
          org_group text NOT NULL DEFAULT 'unassigned',
          department text NOT NULL DEFAULT '',
          position text NOT NULL DEFAULT '',
          sort_order int NOT NULL DEFAULT 1000,
          prompt_override text,
          notes text NOT NULL DEFAULT '',
          started_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now())"""
    )
    op.execute(
        """CREATE TABLE shared.bot_stats(
          slug text PRIMARY KEY,
          calls int NOT NULL DEFAULT 0, errors int NOT NULL DEFAULT 0,
          thumbs_up int NOT NULL DEFAULT 0, thumbs_down int NOT NULL DEFAULT 0,
          latency_ms_total bigint NOT NULL DEFAULT 0,
          first_active_at timestamptz, last_active_at timestamptz)"""
    )
    op.execute("CREATE TABLE shared.org_groups(id text PRIMARY KEY, label text NOT NULL, parent text, sort_order int NOT NULL DEFAULT 1000, kind text NOT NULL DEFAULT 'group')")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS shared.org_groups")
    op.execute("DROP TABLE IF EXISTS shared.bot_stats")
    op.execute("DROP TABLE IF EXISTS shared.bot_org")
