"""Progress tracking utilities for long-running operations."""

import asyncio
import contextlib
import logging

from backend._internal.jobs import job_service
from backend.models.job import JobStatus

logger = logging.getLogger(__name__)


class R2ProgressTracker:
    """Tracks R2 upload progress and updates the job service.

    Bridges the gap between boto3's synchronous callback and our async
    database job service.
    """

    def __init__(
        self,
        job_id: str,
        total_size: int,
        message: str = "uploading to storage...",
        phase: str = "upload",
        update_interval: float = 1.0,
    ):
        self.job_id = job_id
        self.total_size = total_size
        self.message = message
        self.phase = phase
        self.update_interval = update_interval
        self._bytes_transferred = 0
        self._reporter_task: asyncio.Task | None = None

    def on_progress(self, bytes_amount: int) -> None:
        """Synchronous callback for boto3."""
        self._bytes_transferred += bytes_amount

    async def start(self) -> None:
        """Start the background reporting task."""
        self._reporter_task = asyncio.create_task(self._report_loop())

    async def stop(self) -> None:
        """Stop the reporting task and ensure final update."""
        if self._reporter_task:
            self._reporter_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reporter_task
            self._reporter_task = None

    async def _report_loop(self) -> None:
        """Periodic reporting loop."""
        while True:
            pct = self.percentage

            # Don't report 100% until explicitly finished by the caller
            # via final job update, or let it sit at 99.9%
            report_pct = min(pct, 99.9)

            await job_service.update_progress(
                self.job_id,
                JobStatus.PROCESSING,
                self.message,
                phase=self.phase,
                progress_pct=report_pct,
            )

            if pct >= 100.0:
                break

            await asyncio.sleep(self.update_interval)

    @property
    def percentage(self) -> float:
        """Calculate current percentage."""
        if self.total_size <= 0:
            return 0.0 if self._bytes_transferred == 0 else 100.0
        return (self._bytes_transferred / self.total_size) * 100.0
