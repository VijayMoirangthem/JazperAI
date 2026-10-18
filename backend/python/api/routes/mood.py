"""Phase 22 — Mood & Energy Log."""
from __future__ import annotations

from datetime import date, datetime, timezone, timedelta
from typing import Optional

import structlog
import psycopg2.extras
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from memory.db.legacy_pg import _pg

router = APIRouter()
log = structlog.get_logger()


# ── Pydantic models ────────────────────────────────────────────────────────────

class MoodCreate(BaseModel):
    energy: int
    mood: int
    note: str = ""

    @field_validator("energy", "mood")
    @classmethod
    def check_range(cls, v: int) -> int:
        if not (1 <= v <= 5):
            raise ValueError("Value must be between 1 and 5")
        return v


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("")
def log_mood(body: MoodCreate):
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    INSERT INTO mood_logs (energy, mood, note)
                    VALUES (%s, %s, %s)
                    RETURNING *
                    """,
                    (body.energy, body.mood, body.note),
                )
                row = dict(cur.fetchone())
            conn.commit()
        return {
            "id": str(row["id"]),
            "energy": row["energy"],
            "mood": row["mood"],
            "note": row.get("note") or "",
            "logged_at": row["logged_at"].isoformat() if row.get("logged_at") else None,
        }
    except Exception as e:
        log.warning("log_mood failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("/today")
def mood_today():
    today = date.today()
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM mood_logs WHERE logged_at::date = %s ORDER BY logged_at DESC LIMIT 1",
                    (today,),
                )
                row = cur.fetchone()
        if not row:
            return None
        row = dict(row)
        return {
            "id": str(row["id"]),
            "energy": row["energy"],
            "mood": row["mood"],
            "note": row.get("note") or "",
            "logged_at": row["logged_at"].isoformat() if row.get("logged_at") else None,
        }
    except Exception as e:
        log.warning("mood_today failed", error=str(e))
        raise HTTPException(500, str(e))


@router.get("")
def list_mood(days: int = 30):
    since = date.today() - timedelta(days=days)
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT * FROM mood_logs WHERE logged_at::date >= %s ORDER BY logged_at DESC",
                    (since,),
                )
                rows = [dict(r) for r in cur.fetchall()]

                # Focus session dates (for correlation)
                cur.execute(
                    """
                    SELECT started_at::date AS session_date
                    FROM focus_sessions
                    WHERE started_at::date >= %s
                    """,
                    (since,),
                )
                focus_dates = {str(r["session_date"]) for r in cur.fetchall()}

        if not rows:
            return {
                "entries": [],
                "avg_energy": None,
                "avg_mood": None,
                "trend": None,
                "best_day": None,
                "correlation_hint": None,
            }

        entries = [
            {
                "id": str(r["id"]),
                "energy": r["energy"],
                "mood": r["mood"],
                "note": r.get("note") or "",
                "logged_at": r["logged_at"].isoformat() if r.get("logged_at") else None,
            }
            for r in rows
        ]

        avg_energy = round(sum(r["energy"] for r in rows) / len(rows), 2)
        avg_mood = round(sum(r["mood"] for r in rows) / len(rows), 2)

        # Trend: last 7d avg vs prior 7d avg
        today = date.today()
        last7_cutoff = today - timedelta(days=7)
        prior7_cutoff = today - timedelta(days=14)

        last7 = [r for r in rows if r["logged_at"].date() >= last7_cutoff]
        prior7 = [
            r for r in rows
            if prior7_cutoff <= r["logged_at"].date() < last7_cutoff
        ]

        if last7 and prior7:
            l7_energy = sum(r["energy"] for r in last7) / len(last7)
            p7_energy = sum(r["energy"] for r in prior7) / len(prior7)
            l7_mood = sum(r["mood"] for r in last7) / len(last7)
            p7_mood = sum(r["mood"] for r in prior7) / len(prior7)
            trend = {
                "energy_delta": round(l7_energy - p7_energy, 2),
                "mood_delta": round(l7_mood - p7_mood, 2),
                "energy_direction": "up" if l7_energy > p7_energy else ("down" if l7_energy < p7_energy else "flat"),
                "mood_direction": "up" if l7_mood > p7_mood else ("down" if l7_mood < p7_mood else "flat"),
            }
        else:
            trend = None

        # Best day
        from collections import defaultdict
        day_energies: dict = defaultdict(list)
        for r in rows:
            day_energies[str(r["logged_at"].date())].append(r["energy"])
        best_day = max(day_energies, key=lambda d: sum(day_energies[d]) / len(day_energies[d])) if day_energies else None

        # Correlation hint
        focus_days = {str(r["logged_at"].date()) for r in rows if str(r["logged_at"].date()) in focus_dates}
        non_focus_days = {str(r["logged_at"].date()) for r in rows if str(r["logged_at"].date()) not in focus_dates}

        if focus_days and non_focus_days:
            focus_rows = [r for r in rows if str(r["logged_at"].date()) in focus_days]
            non_focus_rows = [r for r in rows if str(r["logged_at"].date()) in non_focus_days]
            avg_focus_energy = sum(r["energy"] for r in focus_rows) / len(focus_rows)
            avg_nf_energy = sum(r["energy"] for r in non_focus_rows) / len(non_focus_rows)
            if avg_focus_energy > avg_nf_energy + 0.3:
                correlation_hint = "High energy correlates with high focus days"
            elif avg_nf_energy > avg_focus_energy + 0.3:
                correlation_hint = "Energy tends to be lower on focus session days — consider pacing"
            else:
                correlation_hint = "No strong energy–focus correlation detected"
        else:
            correlation_hint = "Not enough data for correlation analysis"

        return {
            "entries": entries,
            "avg_energy": avg_energy,
            "avg_mood": avg_mood,
            "trend": trend,
            "best_day": best_day,
            "correlation_hint": correlation_hint,
        }
    except Exception as e:
        log.warning("list_mood failed", error=str(e))
        raise HTTPException(500, str(e))
