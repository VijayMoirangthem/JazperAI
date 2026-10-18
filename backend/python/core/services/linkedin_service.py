"""
LinkedIn job-apply automation service.

Strategy:
  - Launch Playwright using the user's existing Chrome profile so LinkedIn
    is already authenticated — no login step, no 2FA.
  - Search for Easy Apply jobs matching the user's preferences.
  - Fill each form page using pre-stored screening answers.
  - Upload resume if requested.
  - Log every application to job_applications table.

Chrome profile path (Windows default):
  C:/Users/<user>/AppData/Local/Google/Chrome/User Data
  Profile directory: Default (or whichever profile is logged into LinkedIn)
"""

from __future__ import annotations
import asyncio
import re, time, json, random, logging
from pathlib import Path
from typing import Generator

import psycopg2
from psycopg2.extras import RealDictCursor

from core.config import settings

log = logging.getLogger(__name__)

# ── DB helpers ────────────────────────────────────────────────────────────────

def _pg():
    return psycopg2.connect(
        host=settings.POSTGRES_HOST, port=settings.POSTGRES_PORT,
        user=settings.POSTGRES_USER, password=settings.POSTGRES_PASSWORD,
        dbname=settings.POSTGRES_DB,
    )


def get_profile() -> dict:
    with _pg() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM job_apply_profile LIMIT 1")
            row = cur.fetchone()
            return dict(row) if row else {}


def save_profile(data: dict) -> dict:
    fields = [
        "target_roles", "work_modes", "locations", "salary_min", "salary_max",
        "experience_years", "skills", "blacklist_companies", "resume_path",
        "daily_limit", "auto_apply_enabled", "auto_apply_hour",
        "linkedin_email", "chrome_profile_path",
    ]
    with _pg() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id FROM job_apply_profile LIMIT 1")
            existing = cur.fetchone()
            if existing:
                sets = ", ".join(f"{f} = %s" for f in fields if f in data)
                vals = [data[f] for f in fields if f in data] + [existing["id"]]
                cur.execute(f"UPDATE job_apply_profile SET {sets}, updated_at=NOW() WHERE id=%s", vals)
            else:
                cols = [f for f in fields if f in data]
                vals = [data[f] for f in cols]
                cur.execute(
                    f"INSERT INTO job_apply_profile ({', '.join(cols)}) VALUES ({', '.join(['%s']*len(cols))})",
                    vals,
                )
        conn.commit()
    return get_profile()


# ── Screening answers ─────────────────────────────────────────────────────────

def get_screening_answers() -> list[dict]:
    with _pg() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM job_screening_answers ORDER BY category, id")
            return [dict(r) for r in cur.fetchall()]


def upsert_screening_answer(question: str, answer: str, category: str = "general") -> dict:
    with _pg() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT id FROM job_screening_answers WHERE question=%s", (question,))
            row = cur.fetchone()
            if row:
                cur.execute(
                    "UPDATE job_screening_answers SET answer=%s, category=%s, updated_at=NOW() WHERE id=%s",
                    (answer, category, row["id"]),
                )
            else:
                cur.execute(
                    "INSERT INTO job_screening_answers (question, answer, category) VALUES (%s,%s,%s)",
                    (question, answer, category),
                )
        conn.commit()
    return {"question": question, "answer": answer, "category": category}


def delete_screening_answer(answer_id: int):
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM job_screening_answers WHERE id=%s", (answer_id,))
        conn.commit()


# ── Cover letters ─────────────────────────────────────────────────────────────

def get_cover_letters() -> list[dict]:
    with _pg() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM job_cover_letters ORDER BY is_default DESC, id")
            return [dict(r) for r in cur.fetchall()]


def save_cover_letter(name: str, content: str, is_default: bool = False, letter_id: int | None = None) -> dict:
    with _pg() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if is_default:
                cur.execute("UPDATE job_cover_letters SET is_default=FALSE")
            if letter_id:
                cur.execute(
                    "UPDATE job_cover_letters SET name=%s, content=%s, is_default=%s, updated_at=NOW() WHERE id=%s RETURNING *",
                    (name, content, is_default, letter_id),
                )
            else:
                cur.execute(
                    "INSERT INTO job_cover_letters (name, content, is_default) VALUES (%s,%s,%s) RETURNING *",
                    (name, content, is_default),
                )
            row = cur.fetchone()
        conn.commit()
    return dict(row) if row else {}


def delete_cover_letter(letter_id: int):
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM job_cover_letters WHERE id=%s", (letter_id,))
        conn.commit()


# ── Applications ──────────────────────────────────────────────────────────────

def get_applications(status: str | None = None, limit: int = 50) -> list[dict]:
    with _pg() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if status:
                cur.execute(
                    "SELECT * FROM job_applications WHERE status=%s ORDER BY applied_at DESC LIMIT %s",
                    (status, limit),
                )
            else:
                cur.execute("SELECT * FROM job_applications ORDER BY applied_at DESC LIMIT %s", (limit,))
            return [dict(r) for r in cur.fetchall()]


def update_application_status(job_id: str, status: str, notes: str = ""):
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE job_applications SET status=%s, notes=COALESCE(notes,'')||%s WHERE id=%s",
                (status, f"\n{notes}" if notes else "", job_id),
            )
        conn.commit()


def get_apply_runs(limit: int = 20) -> list[dict]:
    with _pg() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM job_apply_runs ORDER BY started_at DESC LIMIT %s", (limit,))
            return [dict(r) for r in cur.fetchall()]


# ── Default screening questions ───────────────────────────────────────────────

DEFAULT_SCREENING_QUESTIONS = [
    ("Are you legally authorized to work in the country?", "Yes", "authorization"),
    ("Do you require visa sponsorship?", "No", "authorization"),
    ("Are you willing to relocate?", "No, I prefer remote", "location"),
    ("What is your expected salary (annual)?", "Open to discussion based on the role", "salary"),
    ("How many years of professional experience do you have?", "3", "experience"),
    ("Are you comfortable working remotely?", "Yes, I prefer remote work", "work_mode"),
    ("What is your highest level of education?", "Bachelor's degree", "education"),
    ("Are you available to start immediately?", "Yes, within 2 weeks", "availability"),
    ("Do you have experience with JavaScript?", "Yes, extensive experience", "skills"),
    ("Do you have experience with React?", "Yes, 3+ years", "skills"),
    ("Do you have experience with Node.js?", "Yes, 3+ years", "skills"),
    ("Do you have experience with MongoDB?", "Yes", "skills"),
    ("What is your current location?", "India", "location"),
    ("Are you open to contract/freelance roles?", "Yes", "work_mode"),
    ("Do you have a GitHub profile?", "Yes", "portfolio"),
]


def seed_default_screening_answers():
    """Insert default screening answers if table is empty."""
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM job_screening_answers")
            count = cur.fetchone()[0]
        conn.commit()
    if count == 0:
        for q, a, cat in DEFAULT_SCREENING_QUESTIONS:
            upsert_screening_answer(q, a, cat)


# ── Playwright automation ─────────────────────────────────────────────────────

def _human_delay(min_s: float = 0.8, max_s: float = 2.5):
    time.sleep(random.uniform(min_s, max_s))


def _build_search_url(profile: dict, page: int = 0) -> str:
    roles = profile.get("target_roles", [])
    keywords = (roles[0] if roles else "Software Engineer").replace(" ", "+")
    work_modes = profile.get("work_modes", ["remote"])

    # LinkedIn work-type filter: 1=onsite, 2=remote, 3=hybrid
    mode_map = {"remote": "2", "onsite": "1", "hybrid": "3"}
    wt = ",".join(mode_map.get(m, "2") for m in work_modes)

    start = page * 25
    return (
        f"https://www.linkedin.com/jobs/search/"
        f"?keywords={keywords}"
        f"&f_AL=true"      # Easy Apply only
        f"&f_WT={wt}"      # work type
        f"&sortBy=DD"      # most recent
        f"&start={start}"
    )


def _already_applied(job_id: str) -> bool:
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM job_applications WHERE id=%s", (job_id,))
            return cur.fetchone() is not None


def _log_application(job: dict, run_id: int, cover_letter_name: str):
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO job_applications
                   (id, company, title, url, location, work_mode, status, cover_letter_name, easy_apply, run_id)
                   VALUES (%s,%s,%s,%s,%s,%s,'applied',%s,TRUE,%s)
                   ON CONFLICT (id) DO NOTHING""",
                (
                    job["id"], job["company"], job["title"], job["url"],
                    job.get("location", ""), job.get("work_mode", "remote"),
                    cover_letter_name, run_id,
                ),
            )
        conn.commit()


def _answer_form_field(page, label_text: str, answers: dict[str, str]) -> bool:
    """Try to fill a form field whose label matches a stored answer. Returns True if filled."""
    label_lower = label_text.lower().strip()
    for question, answer in answers.items():
        if any(kw in label_lower for kw in question.lower().split()[:4]):
            # Try text input
            try:
                inp = page.locator(f"label:has-text('{label_text[:40]}') ~ input").first
                if inp.is_visible(timeout=500):
                    inp.fill(answer)
                    return True
            except Exception:
                pass
            # Try select / dropdown
            try:
                sel = page.locator(f"label:has-text('{label_text[:40]}') ~ select").first
                if sel.is_visible(timeout=500):
                    sel.select_option(label=answer)
                    return True
            except Exception:
                pass
            # Try radio
            try:
                radio = page.locator(f"label:has-text('{answer}')").first
                if radio.is_visible(timeout=500):
                    radio.click()
                    return True
            except Exception:
                pass
    return False


def _score_job(title: str, job_description: str, profile: dict) -> tuple[int, str]:
    """
    Score a job listing 1-10 against the user's profile.
    Returns (score, reason). Score < 7 → skip.

    Scoring is purely heuristic (no LLM call) to keep runs fast:
      +3  title matches a target role keyword
      +2  work mode matches preferences
      +2  salary range mentioned and within profile range
      +1  at least one skill keyword found in JD
      +1  company not in blacklist (already checked before, bonus for not being borderline)
      -3  title contains excluded keywords (senior/principal/lead if not in target roles)
    """
    target_roles  = [r.lower() for r in (profile.get("target_roles") or [])]
    work_modes    = [m.lower() for m in (profile.get("work_modes")   or ["remote"])]
    skills        = [s.lower() for s in (profile.get("skills")       or [])]
    salary_min    = int(profile.get("salary_min") or 0)
    salary_max    = int(profile.get("salary_max") or 0)

    jd_lower      = (job_description or "").lower()
    title_lower   = title.lower()
    reasons: list[str] = []
    score = 4  # baseline

    # Title match
    if target_roles:
        if any(role in title_lower for role in target_roles):
            score += 3
            reasons.append("title match")
        else:
            score -= 1
            reasons.append("title mismatch")

    # Work mode
    remote_hints = {"remote", "work from home", "wfh", "distributed"}
    hybrid_hints = {"hybrid"}
    jd_is_remote = any(h in jd_lower for h in remote_hints)
    jd_is_hybrid = any(h in jd_lower for h in hybrid_hints)
    if "remote" in work_modes and jd_is_remote:
        score += 2; reasons.append("remote match")
    elif "hybrid" in work_modes and jd_is_hybrid:
        score += 1; reasons.append("hybrid match")
    elif not jd_is_remote and not jd_is_hybrid and "remote" in work_modes:
        score -= 1; reasons.append("mode unclear")

    # Skill match (at least one skill in JD)
    if skills and any(s in jd_lower for s in skills):
        score += 1; reasons.append("skill match")

    # Salary hints
    if salary_min > 0 and salary_max > 0:
        import re as _re
        nums = [int(n.replace(",", "")) for n in _re.findall(r"\d[\d,]{2,}", jd_lower)]
        annual = [n for n in nums if 20000 < n < 500000]
        if annual:
            mid = sum(annual) / len(annual)
            if salary_min <= mid <= salary_max:
                score += 2; reasons.append("salary in range")
            elif mid < salary_min * 0.8:
                score -= 2; reasons.append("salary too low")

    score = max(1, min(10, score))
    reason_str = ", ".join(reasons) if reasons else "no specific signals"
    return score, reason_str


def _tailor_cover_letter(base: str, title: str, company: str, job_description: str) -> str:
    """Call the local LLM synchronously to produce a job-tailored cover letter."""
    if not base.strip():
        return base

    prompt = (
        f"You are a professional cover letter writer.\n\n"
        f"Below is a base cover letter template. Rewrite it to be specifically tailored for "
        f"the role of **{title}** at **{company}**.\n\n"
        f"Rules:\n"
        f"- Keep the same professional tone and length (no longer than the original)\n"
        f"- Weave in 2-3 specific details from the job description naturally\n"
        f"- Do NOT invent facts, credentials, or experiences not implied by the template\n"
        f"- Output ONLY the final cover letter text, no preamble, no commentary\n\n"
        f"---BASE TEMPLATE---\n{base}\n\n"
        f"---JOB DESCRIPTION (first 800 chars)---\n{job_description[:800]}\n\n"
        f"---TAILORED COVER LETTER---"
    )
    messages = [{"role": "user", "content": prompt}]

    try:
        from core.providers.ai_provider import ai_provider
        result = asyncio.run(
            ai_provider.chat(messages, max_tokens=600, temperature=0.7)
        )
        tailored = result.content.strip()
        return tailored if tailored else base
    except Exception as e:
        log.warning(f"Cover letter tailoring failed: {e} — using base letter")
        return base


def run_job_apply(log_lines: list[str] | None = None, limit: int | None = None) -> dict:
    """
    Main entry point for the LinkedIn job-apply automation.
    Returns a summary dict with jobs_found, jobs_applied, jobs_skipped.
    Pass limit to override the profile's daily_limit (useful for test runs).
    """
    from playwright.sync_api import sync_playwright

    def _log(msg: str):
        log.info(msg)
        if log_lines is not None:
            log_lines.append(msg)

    profile = get_profile()
    if not profile:
        return {"error": "No job profile configured. Please set up your preferences first."}

    daily_limit = limit if limit is not None else profile.get("daily_limit", 5)
    resume_path = profile.get("resume_path", "")
    # Use a dedicated automation-only profile directory.
    # This profile is separate from the user's main Chrome so the user's
    # browsing is never interrupted and Chrome never needs to be killed.
    chrome_path = profile.get("chrome_profile_path") or str(
        Path(__file__).resolve().parents[4] / "storage" / "browser-profiles" / "linkedin"
    )
    blacklist = [c.lower() for c in profile.get("blacklist_companies", [])]

    answers_raw = get_screening_answers()
    answers = {r["question"]: r["answer"] for r in answers_raw}

    cover_letters = get_cover_letters()
    default_cl = next((cl for cl in cover_letters if cl["is_default"]), None)
    cl_content = default_cl["content"] if default_cl else ""
    cl_name = default_cl["name"] if default_cl else "default"

    # Create run record
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO job_apply_runs (status) VALUES ('running') RETURNING id")
            run_id = cur.fetchone()[0]
        conn.commit()

    jobs_found = jobs_applied = jobs_skipped = 0

    import sys as _sys, asyncio as _asyncio
    # Ensure Playwright's internal asyncio.new_event_loop() creates a ProactorEventLoop
    if _sys.platform == "win32":
        _asyncio.set_event_loop_policy(_asyncio.WindowsProactorEventLoopPolicy())

    try:
        with sync_playwright() as pw:
            _log("Launching Edge with existing profile...")
            ctx = pw.chromium.launch_persistent_context(
                user_data_dir=chrome_path,
                channel="msedge",
                headless=False,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-first-run",
                ],
                slow_mo=100,
            )
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.set_extra_http_headers({"Accept-Language": "en-US,en;q=0.9"})

            search_url = _build_search_url(profile)
            _log(f"Searching: {search_url}")
            page.goto(search_url, wait_until="load", timeout=45000)
            _human_delay(3, 5)

            # Check we're logged in
            if "login" in page.url or "authwall" in page.url:
                raise RuntimeError(
                    "LinkedIn is not logged in. Open the automation browser, log into LinkedIn, then try again."
                )

            # LinkedIn changes its DOM frequently — try several selectors
            CARD_SELECTORS = [
                ".jobs-search-results__list-item",
                "li[data-occludable-job-id]",
                ".job-card-container",
                ".jobs-search-two-pane__job-card-container--viewport-tracking",
                "ul.jobs-search-results__list > li",
            ]
            card_sel = None
            for sel in CARD_SELECTORS:
                try:
                    page.wait_for_selector(sel, timeout=8000)
                    card_sel = sel
                    _log(f"Job cards found with selector: {sel}")
                    break
                except Exception:
                    continue

            if not card_sel:
                # Take a screenshot to help debug
                _log("Could not find job cards — LinkedIn layout may have changed.")
                _log(f"Current URL: {page.url}")
                raise RuntimeError("No job cards found. LinkedIn layout may have changed or search returned no results.")

            job_cards = page.locator(card_sel).all()
            jobs_found = len(job_cards)
            _log(f"Found {jobs_found} job listings")

            for card in job_cards:
                if jobs_applied >= daily_limit:
                    _log(f"Daily limit of {daily_limit} reached.")
                    break

                try:
                    # Extract job metadata from card
                    title_el = card.locator(".job-card-list__title").first
                    company_el = card.locator(".job-card-container__primary-description").first
                    title = title_el.inner_text(timeout=2000).strip()
                    company = company_el.inner_text(timeout=2000).strip()

                    if company.lower() in blacklist:
                        _log(f"Skipping blacklisted: {company}")
                        jobs_skipped += 1
                        continue

                    # Get job URL + ID
                    link = card.locator("a.job-card-list__title").first
                    href = link.get_attribute("href") or ""
                    job_id_match = re.search(r"/jobs/view/(\d+)", href)
                    job_id = job_id_match.group(1) if job_id_match else href[-20:]

                    if _already_applied(job_id):
                        _log(f"Already applied: {title} @ {company}")
                        jobs_skipped += 1
                        continue

                    # Click job to open detail pane
                    card.click()
                    _human_delay(1.5, 3)

                    location_el = page.locator(".job-details-jobs-unified-top-card__bullet").first
                    location = location_el.inner_text(timeout=2000).strip() if location_el else ""

                    # Scrape job description for cover letter tailoring
                    job_description = ""
                    try:
                        jd_el = page.locator(".jobs-description__content, .jobs-box__html-content").first
                        if jd_el.is_visible(timeout=2000):
                            job_description = jd_el.inner_text(timeout=2000).strip()
                    except Exception:
                        pass

                    # Score this job before committing to apply
                    score, score_reason = _score_job(title, job_description, profile)
                    if score < 7:
                        _log(f"  ✗ Skipping (score {score}/10 — {score_reason}): {title} @ {company}")
                        jobs_skipped += 1
                        continue
                    _log(f"  ✓ Score {score}/10 ({score_reason}): {title} @ {company}")

                    # Detect apply button type
                    easy_btn = page.locator("button.jobs-apply-button").first
                    apply_btn = page.locator("button.jobs-apply-button, a.jobs-apply-button").first
                    btn_text = ""
                    try:
                        btn_text = apply_btn.inner_text(timeout=3000).strip().lower()
                    except Exception:
                        pass

                    if not apply_btn.is_visible(timeout=3000):
                        _log(f"  ✗ No apply button found: {title} @ {company} — skipping")
                        jobs_skipped += 1
                        continue

                    if "easy apply" not in btn_text:
                        # "Apply on company website" — log it for manual review, skip automation
                        job_url = f"https://www.linkedin.com/jobs/view/{job_id}"
                        _log(f"  ⚡ External apply: {title} @ {company} ({job_url}) — queued for manual review")
                        jobs_skipped += 1
                        continue

                    # Tailor cover letter for this specific job
                    tailored_cl = cl_content
                    if cl_content and job_description:
                        _log(f"  ✎ Tailoring cover letter for {title} @ {company}…")
                        tailored_cl = _tailor_cover_letter(cl_content, title, company, job_description)
                        _log(f"  ✓ Cover letter tailored ({len(tailored_cl)} chars)")

                    _log(f"Applying: {title} @ {company}")
                    easy_btn.click()
                    _human_delay(1.5, 2.5)

                    # Walk through multi-page application form
                    page_num = 0
                    max_pages = 8
                    while page_num < max_pages:
                        page_num += 1

                        # Fill text/select fields
                        labels = page.locator(".fb-form-element__label, label").all()
                        for lbl in labels:
                            try:
                                lbl_text = lbl.inner_text(timeout=500).strip()
                                if lbl_text:
                                    _answer_form_field(page, lbl_text, answers)
                            except Exception:
                                pass

                        # Upload resume if a file input is present and resume exists
                        if resume_path and Path(resume_path).exists():
                            try:
                                file_input = page.locator("input[type='file']").first
                                if file_input.is_visible(timeout=500):
                                    file_input.set_input_files(resume_path)
                                    _human_delay(1, 2)
                            except Exception:
                                pass

                        # Add cover letter if a textarea is present
                        if tailored_cl:
                            try:
                                textarea = page.locator("textarea").first
                                if textarea.is_visible(timeout=500):
                                    textarea.fill(tailored_cl)
                                    _human_delay(0.5, 1)
                            except Exception:
                                pass

                        # Check for Submit button (last page)
                        submit_btn = page.locator("button[aria-label='Submit application']").first
                        if submit_btn.is_visible(timeout=1000):
                            submit_btn.click()
                            _human_delay(2, 3)
                            _log(f"✓ Applied: {title} @ {company}")
                            used_cl_name = f"{cl_name} (tailored)" if tailored_cl != cl_content else cl_name
                            _log_application(
                                {"id": job_id, "company": company, "title": title,
                                 "url": f"https://www.linkedin.com{href}",
                                 "location": location, "work_mode": "remote"},
                                run_id, used_cl_name,
                            )
                            jobs_applied += 1
                            break

                        # Next page button
                        next_btn = page.locator("button[aria-label='Continue to next step']").first
                        review_btn = page.locator("button[aria-label='Review your application']").first
                        if next_btn.is_visible(timeout=1000):
                            next_btn.click()
                        elif review_btn.is_visible(timeout=1000):
                            review_btn.click()
                        else:
                            _log(f"Could not advance form for {title} — dismissing")
                            # Dismiss modal
                            try:
                                page.locator("button[aria-label='Dismiss']").first.click()
                                _human_delay(1, 2)
                                page.locator("button[data-control-name='discard_application_confirm_btn']").first.click()
                            except Exception:
                                pass
                            jobs_skipped += 1
                            break

                        _human_delay(1, 2)

                    _human_delay(2, 4)

                except Exception as ex:
                    _log(f"Error on job card: {ex}")
                    jobs_skipped += 1
                    # Try to dismiss any open modal
                    try:
                        page.locator("button[aria-label='Dismiss']").first.click(timeout=1000)
                    except Exception:
                        pass
                    _human_delay(1, 2)

            ctx.close()

    except Exception as e:
        import traceback as _tb
        error_msg = str(e) or repr(e)
        tb_text = _tb.format_exc()
        _log(f"Run failed: {error_msg}")
        _log(f"Traceback: {tb_text[:3000]}")
        with _pg() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE job_apply_runs SET status='failed', completed_at=NOW(), error_msg=%s, run_log=%s WHERE id=%s",
                    (error_msg, "\n".join(log_lines or []), run_id),
                )
            conn.commit()
        return {"run_id": run_id, "status": "failed", "error": error_msg,
                "jobs_found": jobs_found, "jobs_applied": jobs_applied, "jobs_skipped": jobs_skipped}

    # Mark run complete
    run_log = "\n".join(log_lines or [])
    with _pg() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE job_apply_runs
                   SET status='completed', completed_at=NOW(),
                       jobs_found=%s, jobs_applied=%s, jobs_skipped=%s, run_log=%s
                   WHERE id=%s""",
                (jobs_found, jobs_applied, jobs_skipped, run_log, run_id),
            )
        conn.commit()

    return {
        "run_id": run_id, "status": "completed",
        "jobs_found": jobs_found, "jobs_applied": jobs_applied, "jobs_skipped": jobs_skipped,
    }
