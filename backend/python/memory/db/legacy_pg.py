"""Legacy sync Postgres helper (psycopg2). Used only from sync `def` code (FastAPI threadpool / executors).
New code must use memory.db.aio. Replace this module's driver in one place when the legacy callers are ported.
"""
from contextlib import contextmanager

import psycopg2

from core.config import settings


@contextmanager
def _pg():
    conn = psycopg2.connect(
        host=settings.POSTGRES_HOST,
        port=settings.POSTGRES_PORT,
        user=settings.POSTGRES_USER,
        password=settings.POSTGRES_PASSWORD,
        dbname=settings.POSTGRES_DB,
    )
    try:
        yield conn
    finally:
        conn.close()
