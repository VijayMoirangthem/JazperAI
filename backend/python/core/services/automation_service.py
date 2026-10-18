"""
Phase 11A — Automation Rules engine.

fire_event(event_type, data) is called by workers when something happens.
It checks all enabled rules for that event type, evaluates conditions,
and executes matched actions.
"""
from __future__ import annotations
import asyncio
import structlog
from memory.db.legacy_pg import _pg

log = structlog.get_logger()

# ── Built-in rule templates ───────────────────────────────────────────────────

BUILT_IN_TEMPLATES = [
    {
        "name": "Interview invite → Create task + Alert",
        "trigger_event": "email_classified",
        "conditions": [{"field": "category", "op": "eq", "value": "interview_invite"}],
        "actions": [
            {"type": "create_task", "params": {"title": "Prepare for interview with {company}", "priority": "high"}},
            {"type": "send_telegram", "params": {"message": "🎯 Interview invite from {company}! Task created."}},
        ],
    },
    {
        "name": "Recruiter email → Create follow-up task",
        "trigger_event": "email_classified",
        "conditions": [{"field": "category", "op": "in", "value": ["recruiter_outreach", "response"]}],
        "actions": [
            {"type": "create_task", "params": {"title": "Reply to {sender} at {company}", "priority": "medium"}},
        ],
    },
    {
        "name": "Job offer → High-priority task + Alert",
        "trigger_event": "email_classified",
        "conditions": [{"field": "category", "op": "eq", "value": "offer_letter"}],
        "actions": [
            {"type": "create_task", "params": {"title": "Review job offer from {company}", "priority": "high"}},
            {"type": "send_telegram", "params": {"message": "🎉 Job offer from {company}! Created a task to review it."}},
        ],
    },
    {
        "name": "Job rejection → Log note",
        "trigger_event": "job_status_changed",
        "conditions": [{"field": "new_status", "op": "eq", "value": "rejected"}],
        "actions": [
            {"type": "create_notification", "params": {"title": "Rejection from {company}", "body": "{title} position", "type": "warning"}},
        ],
    },
]


def get_templates() -> list[dict]:
    return BUILT_IN_TEMPLATES


def get_rules() -> list[dict]:
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, name, trigger_event, conditions, actions,
                           enabled, run_count, last_fired_at, created_at
                    FROM automation_rules ORDER BY created_at DESC
                """)
                cols = [d[0] for d in cur.description]
                rows = cur.fetchall()
        return [dict(zip(cols, r)) for r in rows]
    except Exception as e:
        log.warning("get_rules failed", error=str(e))
        return []


def create_rule(name: str, trigger_event: str, conditions: list, actions: list) -> dict:
    with _pg() as conn:
        with conn.cursor() as cur:
            import json
            cur.execute("""
                INSERT INTO automation_rules (name, trigger_event, conditions, actions)
                VALUES (%s, %s, %s, %s) RETURNING id
            """, (name, trigger_event, json.dumps(conditions), json.dumps(actions)))
            rule_id = cur.fetchone()[0]
        conn.commit()
    return {"id": str(rule_id), "name": name}


def update_rule(rule_id: str, updates: dict) -> None:
    import json
    allowed = {"name", "trigger_event", "conditions", "actions", "enabled"}
    clean = {k: v for k, v in updates.items() if k in allowed}
    if not clean:
        return
    parts = []
    vals = []
    for k, v in clean.items():
        parts.append(f"{k} = %s")
        vals.append(json.dumps(v) if isinstance(v, (list, dict)) else v)
    vals.append(rule_id)
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(f"UPDATE automation_rules SET {', '.join(parts)} WHERE id = %s", vals)
        conn.commit()


def delete_rule(rule_id: str) -> None:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM automation_rules WHERE id = %s", (rule_id,))
        conn.commit()


def get_history(limit: int = 20) -> list[dict]:
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT h.id, h.rule_id, r.name as rule_name,
                           h.trigger_data, h.actions_fired, h.success,
                           h.error_msg, h.fired_at
                    FROM automation_history h
                    LEFT JOIN automation_rules r ON r.id = h.rule_id
                    ORDER BY h.fired_at DESC LIMIT %s
                """, (limit,))
                cols = [d[0] for d in cur.description]
                rows = cur.fetchall()
        result = []
        for r in rows:
            row = dict(zip(cols, r))
            row["fired_at"] = row["fired_at"].isoformat() if row["fired_at"] else None
            result.append(row)
        return result
    except Exception as e:
        log.warning("get_history failed", error=str(e))
        return []


def _eval_condition(cond: dict, data: dict) -> bool:
    field = cond.get("field", "")
    op = cond.get("op", "eq")
    expected = cond.get("value")
    actual = data.get(field)
    if op == "eq":
        return actual == expected
    if op == "in":
        return actual in (expected if isinstance(expected, list) else [expected])
    if op == "contains":
        return expected in str(actual or "").lower()
    if op == "ne":
        return actual != expected
    return False


def _interpolate(text: str, data: dict) -> str:
    for k, v in data.items():
        text = text.replace(f"{{{k}}}", str(v or ""))
    return text


async def _execute_action(action: dict, data: dict) -> None:
    atype = action.get("type")
    params = action.get("params", {})

    if atype == "create_task":
        title = _interpolate(params.get("title", "Task"), data)
        priority = params.get("priority", "medium")
        try:
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO tasks (title, priority, status) VALUES (%s, %s, 'todo')",
                        (title, priority),
                    )
                conn.commit()
            log.info("Automation: task created", title=title)
        except Exception as e:
            log.warning("Automation: create_task failed", error=str(e))

    elif atype == "send_telegram":
        msg = _interpolate(params.get("message", ""), data)
        try:
            from core.services.telegram_service import send_message
            await send_message(msg)
        except Exception as e:
            log.warning("Automation: send_telegram failed", error=str(e))

    elif atype == "create_notification":
        title = _interpolate(params.get("title", "Notification"), data)
        body = _interpolate(params.get("body", ""), data)
        ntype = params.get("type", "info")
        try:
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO notifications (title, body, type) VALUES (%s,%s,%s)",
                        (title, body, ntype),
                    )
                conn.commit()
        except Exception as e:
            log.warning("Automation: create_notification failed", error=str(e))


async def fire_event(event_type: str, data: dict) -> None:
    """
    Called by workers when something happens.
    Evaluates all enabled rules for this event type and fires matching actions.
    Non-blocking — designed to be called with asyncio.create_task().
    """
    import json
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, name, conditions, actions FROM automation_rules WHERE trigger_event = %s AND enabled = TRUE",
                    (event_type,),
                )
                rules = cur.fetchall()
    except Exception as e:
        log.warning("fire_event: rules fetch failed", error=str(e))
        return

    for rule_id, rule_name, conditions_raw, actions_raw in rules:
        try:
            conditions = conditions_raw if isinstance(conditions_raw, list) else json.loads(conditions_raw)
            actions = actions_raw if isinstance(actions_raw, list) else json.loads(actions_raw)
        except Exception:
            continue

        # All conditions must match
        if not all(_eval_condition(c, data) for c in conditions):
            continue

        actions_fired = []
        success = True
        error_msg = None
        try:
            for action in actions:
                await _execute_action(action, data)
                actions_fired.append(action.get("type"))
            # Update run_count
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE automation_rules SET run_count = run_count + 1, last_fired_at = NOW() WHERE id = %s",
                        (rule_id,),
                    )
                conn.commit()
        except Exception as e:
            success = False
            error_msg = str(e)

        # Log to history
        try:
            with _pg() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO automation_history
                            (rule_id, trigger_data, actions_fired, success, error_msg)
                        VALUES (%s, %s, %s, %s, %s)
                    """, (rule_id, json.dumps(data), json.dumps(actions_fired), success, error_msg))
                conn.commit()
        except Exception:
            pass

        log.info("Automation rule fired", rule=rule_name, actions=actions_fired, success=success)
