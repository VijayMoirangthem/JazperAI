"""
Interview Prep Worker — researches a company before an interview.

Will:
1. Load upcoming interviews from calendar/DB
2. Scrape company website, LinkedIn, Glassdoor
3. Summarise culture, recent news, likely interview questions
4. Save report to job_runs result and notify user
"""
from app.workers.base_worker import BaseWorker


class InterviewPrepWorker(BaseWorker):
    name = "interview_prep"

    async def run(self, config: dict, dry_run: bool = False) -> dict:
        raise NotImplementedError("InterviewPrepWorker not yet implemented")
