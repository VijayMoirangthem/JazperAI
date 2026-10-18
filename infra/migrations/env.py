import os
from urllib.parse import quote_plus

from alembic import context
from sqlalchemy import create_engine, pool

from core.config import settings


def _url() -> str:
    if os.getenv("ALEMBIC_DATABASE_URL"):
        return os.environ["ALEMBIC_DATABASE_URL"]
    s = settings
    return (f"postgresql+psycopg2://{s.POSTGRES_USER}:{quote_plus(s.POSTGRES_PASSWORD)}"
            f"@{s.POSTGRES_HOST}:{s.POSTGRES_PORT}/{s.POSTGRES_DB}")


def run() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=None)
        with context.begin_transaction():
            context.run_migrations()


run()
