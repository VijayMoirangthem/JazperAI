"""Habit Tracker — daily habits with streak tracking."""
from datetime import date, timedelta
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import psycopg2.extras

from core.services.memory_service import _pg

router = APIRouter()


class HabitCreate(BaseModel):
    title: str
    emoji: str = "✅"


def _calc_streak(comp_dates: list) -> int:
    if not comp_dates:
        return 0
    comp_set = set(comp_dates)
    today = date.today()
    check = today
    streak = 0
    while check in comp_set:
        streak += 1
        check -= timedelta(days=1)
    if streak == 0:
        check = today - timedelta(days=1)
        while check in comp_set:
            streak += 1
            check -= timedelta(days=1)
    return streak


@router.get("")
def list_habits():
    today = date.today()
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT * FROM habits ORDER BY created_at")
                habits = [dict(h) for h in cur.fetchall()]
                result = []
                for h in habits:
                    hid = h["id"]
                    cur.execute(
                        "SELECT completed_date FROM habit_completions WHERE habit_id = %s ORDER BY completed_date DESC",
                        (str(hid),)
                    )
                    comp_dates = [r["completed_date"] for r in cur.fetchall()]
                    streak = _calc_streak(comp_dates)
                    result.append({
                        "id": str(hid),
                        "title": h["title"],
                        "emoji": h.get("emoji") or "✅",
                        "streak": streak,
                        "completed_today": today in comp_dates,
                        "created_at": h["created_at"].isoformat() if h.get("created_at") else None,
                    })
        return result
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("")
def create_habit(body: HabitCreate):
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "Title required")
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "INSERT INTO habits (title, emoji) VALUES (%s, %s) RETURNING *",
                    (title, body.emoji),
                )
                row = dict(cur.fetchone())
            conn.commit()
        return {"id": str(row["id"]), "title": row["title"], "emoji": row.get("emoji", "✅"), "streak": 0, "completed_today": False}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.delete("/{habit_id}")
def delete_habit(habit_id: str):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM habits WHERE id = %s", (habit_id,))
            conn.commit()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/{habit_id}/complete")
def complete_habit(habit_id: str):
    today = date.today()
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO habit_completions (habit_id, completed_date) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                    (habit_id, today),
                )
            conn.commit()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.delete("/{habit_id}/complete")
def uncomplete_habit(habit_id: str):
    today = date.today()
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM habit_completions WHERE habit_id = %s AND completed_date = %s",
                    (habit_id, today),
                )
            conn.commit()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(500, str(e))
