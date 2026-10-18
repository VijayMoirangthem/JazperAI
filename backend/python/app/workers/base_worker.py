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
        try:
            from app.services.error_store import capture_current_exception
            capture_current_exception(
                agent=self.name,
                context={"job_run_id": job_run_id, "error_type": type(error).__name__},
            )
        except Exception:
            pass  # never let error recording crash the worker teardown
