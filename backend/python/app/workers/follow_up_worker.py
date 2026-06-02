"""
Follow-up Worker — sends follow-up emails after job applications.

Will:
1. Query applied jobs older than config['days_after'] with no response
2. Draft a polite follow-up email via email_tool
3. Send email and log outcome
"""
from app.workers.base_worker import BaseWorker


class FollowUpWorker(BaseWorker):
    name = "follow_up"

    async def run(self, config: dict, dry_run: bool = False) -> dict:
        raise NotImplementedError("FollowUpWorker not yet implemented")
