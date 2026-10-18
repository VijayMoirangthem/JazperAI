"""Job Market Radar — daily auto-scan for matching jobs."""
from fastapi import APIRouter
from pydantic import BaseModel
import psycopg2.extras
import structlog
import datetime

from memory.db.legacy_pg import _pg

router = APIRouter()
log = structlog.get_logger()


@router.get("")
def list_radar_hits(limit: int = 50, status: str = "new"):
    hits = []
    try:
        with _pg() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if status == "all":
                    cur.execute("""
                        SELECT id::text, title, company, location, url, relevance, status, matched_at
                        FROM job_radar_items
                        ORDER BY matched_at DESC LIMIT %s
                    """, (limit,))
                else:
                    cur.execute("""
                        SELECT id::text, title, company, location, url, relevance, status, matched_at
                        FROM job_radar_items
                        WHERE status = %s
                        ORDER BY matched_at DESC LIMIT %s
                    """, (status, limit))
                for r in cur.fetchall():
                    row = dict(r)
                    row["matched_at"] = row["matched_at"].isoformat() if row.get("matched_at") else None
                    hits.append(row)
    except Exception as e:
        log.warning("Radar list failed", error=str(e))
    return {"hits": hits, "count": len(hits)}


class StatusUpdate(BaseModel):
    status: str  # new | saved | dismissed


@router.patch("/{hit_id}/status")
def update_hit_status(hit_id: str, body: StatusUpdate):
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE job_radar_items SET status = %s WHERE id = %s",
                    (body.status, hit_id)
                )
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/scan")
async def trigger_scan():
    """Manually trigger a radar scan."""
    try:
        count = await _run_radar_scan()
        return {"ok": True, "new_hits": count}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def _run_radar_scan() -> int:
    """Fetch profile keywords → search jobs → store new matches. Returns count of new hits."""
    from memory.db.legacy_pg import _pg
    from api.routes import jobs as jobs_route

    # Get profile keywords
    keywords = []
    try:
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT skills, current_role FROM user_profile WHERE id = 1")
                row = cur.fetchone()
                if row:
                    skills = row[0] or []
                    role = row[1] or ""
                    if role:
                        keywords.append(role)
                    keywords.extend((skills[:3] if skills else []))
    except Exception as e:
        log.warning("Radar: profile fetch failed", error=str(e))

    if not keywords:
        keywords = ["software engineer"]

    query = " ".join(keywords[:2])
    log.info("Radar scan", query=query)

    # Search jobs (reuse existing jobs route logic)
    new_count = 0
    try:
        # Import search function from jobs module
        from api.routes.jobs import search_jobs as _search
        results = await _search(q=query, limit=10)
        job_list = results.get("jobs", []) if isinstance(results, dict) else []

        with _pg() as conn:
            with conn.cursor() as cur:
                for job in job_list:
                    job_id = str(job.get("id", "")) or job.get("url", "")[:100]
                    if not job_id:
                        continue
                    # Check if already stored
                    cur.execute("SELECT 1 FROM job_radar_items WHERE url = %s", (job.get("url", ""),))
                    if cur.fetchone():
                        continue
                    cur.execute("""
                        INSERT INTO job_radar_items (title, company, location, url, relevance, status)
                        VALUES (%s, %s, %s, %s, %s, 'new')
                    """, (
                        job.get("title", "Unknown")[:255],
                        job.get("company", "")[:255],
                        job.get("location", "")[:255],
                        job.get("url", "")[:500],
                        job.get("relevance", 0.5),
                    ))
                    new_count += 1
    except Exception as e:
        log.warning("Radar scan failed", error=str(e))

    return new_count
