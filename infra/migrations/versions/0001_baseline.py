"""Baseline = schema dumped from the live pre-Jasper DB (init.sql + app/db/init.py + business/db.py).

Existing DB: `alembic stamp 0001`. Empty DB: `alembic upgrade head`.
"""
from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

_SQL = Path(__file__).resolve().parent.parent / "baseline_schema.sql"


def upgrade() -> None:
    conn = op.get_bind().connection
    cur = conn.cursor()
    cur.execute("SET search_path = public")
    cur.execute(_SQL.read_text(encoding="utf-8"))
    cur.execute("SET search_path = public")


def downgrade() -> None:
    raise NotImplementedError("baseline cannot be downgraded")
