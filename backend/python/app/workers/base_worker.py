from abc import ABC, abstractmethod
import structlog

log = structlog.get_logger()


class BaseWorker(ABC):
    """Abstract base for all Jazper autonomous workers."""

    name: str = "base"

    @abstractmethod
    async def run(self, config: dict, dry_run: bool = False) -> dict:
        """Execute the worker. Must return a summary dict."""
        ...

    async def on_success(self, result: dict, job_run_id: str) -> None:
        log.info("Worker succeeded", worker=self.name, job_run_id=job_run_id, result=result)

    async def on_failure(self, error: Exception, job_run_id: str) -> None:
        log.error("Worker failed", worker=self.name, job_run_id=job_run_id, error=str(error))
