"""
Email Sync Worker — incremental Gmail sync every 5 minutes.

Uses Gmail History API to fetch only new/changed messages since last checkpoint.
Invalidates Redis cache entries for changed messages so the next UI open is fresh.
Never re-downloads the full inbox — just processes the diff.
"""
import structlog
from agents.workers.base_worker import BaseWorker

log = structlog.get_logger()


class EmailSyncWorker(BaseWorker):
    name = "email_sync"

    async def run(self, config: dict, dry_run: bool = False) -> dict:
        import asyncio
        from core.services.gmail_service import incremental_sync, list_connected_accounts

        accounts = await asyncio.get_event_loop().run_in_executor(
            None, list_connected_accounts
        )
        if not accounts:
            return {"skipped": True, "reason": "No Gmail accounts connected"}

        results = {}
        for account in accounts:
            try:
                result = await asyncio.get_event_loop().run_in_executor(
                    None, incremental_sync
                )
                results[account["email"]] = result
            except Exception as e:
                log.warning("Incremental sync failed for account",
                            email=account["email"], error=str(e))
                results[account["email"]] = {"error": str(e)}

        return results
