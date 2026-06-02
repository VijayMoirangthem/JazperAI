"""
Salary Research Worker — researches market salary for a target role.

Will:
1. Accept config: {title, location, experience_years}
2. Scrape Glassdoor, Levels.fyi, LinkedIn Salary
3. Aggregate percentile bands
4. Store report in job_runs result
"""
from app.workers.base_worker import BaseWorker


class SalaryResearchWorker(BaseWorker):
    name = "salary_research"

    async def run(self, config: dict, dry_run: bool = False) -> dict:
        raise NotImplementedError("SalaryResearchWorker not yet implemented")
