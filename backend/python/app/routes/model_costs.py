"""Phase 9C — Model Cost Dashboard API"""
from __future__ import annotations
from fastapi import APIRouter
from pydantic import BaseModel
import psycopg2
import structlog
from app.core.config import settings as s
from app.services.model_router import classify, _PRICING

router = APIRouter()
log = structlog.get_logger()


def _conn():
    return psycopg2.connect(
        host=s.POSTGRES_HOST, port=s.POSTGRES_PORT,
        user=s.POSTGRES_USER, password=s.POSTGRES_PASSWORD, dbname=s.POSTGRES_DB,
    )


@router.get("/summary")
def cost_summary(days: int = 30):
    """Aggregated cost by model for the last N days."""
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT model,
                   SUM(input_tokens)  AS total_input,
                   SUM(output_tokens) AS total_output,
                   SUM(cost_usd)      AS total_cost,
                   COUNT(*)           AS calls
            FROM model_cost_log
            WHERE created_at >= NOW() - INTERVAL '%s days'
            GROUP BY model
            ORDER BY total_cost DESC
        """, (days,))
        rows = cur.fetchall()
        return [
            {"model": r[0], "input_tokens": r[1], "output_tokens": r[2],
             "cost_usd": round(r[3], 6), "calls": r[4]}
            for r in rows
        ]
    finally:
        cur.close(); conn.close()


@router.get("/daily")
def cost_daily(days: int = 14):
    """Daily cost totals for the last N days."""
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT DATE(created_at) AS day,
                   SUM(cost_usd)    AS total_cost,
                   COUNT(*)         AS calls,
                   SUM(input_tokens + output_tokens) AS total_tokens
            FROM model_cost_log
            WHERE created_at >= NOW() - INTERVAL '%s days'
            GROUP BY day ORDER BY day ASC
        """, (days,))
        rows = cur.fetchall()
        return [
            {"day": str(r[0]), "cost_usd": round(r[1], 6),
             "calls": r[2], "total_tokens": r[3]}
            for r in rows
        ]
    finally:
        cur.close(); conn.close()


@router.get("/by-source")
def cost_by_source(days: int = 30):
    """Cost breakdown by source (chat / chain / voice / agent)."""
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT source, SUM(cost_usd) AS total_cost, COUNT(*) AS calls
            FROM model_cost_log
            WHERE created_at >= NOW() - INTERVAL '%s days'
            GROUP BY source ORDER BY total_cost DESC
        """, (days,))
        rows = cur.fetchall()
        return [{"source": r[0], "cost_usd": round(r[1], 6), "calls": r[2]} for r in rows]
    finally:
        cur.close(); conn.close()


@router.get("/recent")
def recent_calls(limit: int = 50):
    """Most recent individual LLM calls."""
    conn = _conn(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT model, input_tokens, output_tokens, cost_usd, source, session_id, created_at
            FROM model_cost_log ORDER BY created_at DESC LIMIT %s
        """, (limit,))
        rows = cur.fetchall()
        return [
            {"model": r[0], "input_tokens": r[1], "output_tokens": r[2],
             "cost_usd": round(r[3], 6), "source": r[4], "session_id": r[5],
             "created_at": r[6].isoformat()}
            for r in rows
        ]
    finally:
        cur.close(); conn.close()


class ClassifyBody(BaseModel):
    message: str


@router.post("/classify")
def classify_message(body: ClassifyBody):
    """Classify a message and return the recommended model tier."""
    return classify(body.message)


@router.get("/pricing")
def model_pricing():
    """Return the pricing table used for cost estimates."""
    return [
        {"model": m, "input_per_1m_usd": inp, "output_per_1m_usd": out}
        for m, (inp, out) in sorted(_PRICING.items())
    ]
