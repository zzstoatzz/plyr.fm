"""Progress tracking utilities for long-running operations."""

import asyncio
import contextlib
import logging
from typing import Any

from backend._internal.jobs import job_service
from backend.models.job import JobStatus

logger = logging.getLogger(__name__)


class R2ProgressTracker:
    """Tracks R2 upload progress and updates the job service.

    Bridges the gap between the synchronous storage callback and our async
    database job service. Receives percentage updates from the storage layer
    and periodically reports them to the job service.
    """

    def __init__(
        self,
        job_id: str,
        message: str = "uploading to storage...",
        phase: str = "upload",
        update_interval: float = 1.0,
    ):
        self.job_id = job_id
        self.message = message
        self.phase = phase
        self.update_interval = update_interval
        self._progress_pct: float = 0.0
        self._reporter_task: asyncio.Task | None = None

    def on_progress(self, progress_pct: float) -> None:
        """Synchronous callback that receives percentage (0-100) from storage layer."""
        self._progress_pct = progress_pct

    async def __aenter__(self) -> "R2ProgressTracker":
        await self.start()
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        await self.stop()

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
            # Don't report 100% until explicitly finished by the caller
            # via final job update, or let it sit at 99.9%
            report_pct = min(self._progress_pct, 99.9)

            await job_service.update_progress(
                self.job_id,
                JobStatus.PROCESSING,
                self.message,
                phase=self.phase,
                progress_pct=report_pct,
            )

            if self._progress_pct >= 100.0:
                break

            await asyncio.sleep(self.update_interval)
