"""Hive (tasks/board/log) moved from storage/hive files into Postgres (files stay as an export)."""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE co.hive_tasks(id text PRIMARY KEY, status text NOT NULL, position int NOT NULL, data jsonb NOT NULL)""")
    op.execute("""CREATE TABLE co.hive_log(seq bigserial PRIMARY KEY, data jsonb NOT NULL)""")
    op.execute("""CREATE TABLE co.hive_board(id int PRIMARY KEY DEFAULT 1 CHECK (id = 1), body text NOT NULL DEFAULT '')""")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS co.hive_tasks, co.hive_log, co.hive_board")
