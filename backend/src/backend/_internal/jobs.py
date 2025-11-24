"""Database-backed job tracking service."""

import logging
from datetime import UTC, datetime
from typing import Any

import logfire
from sqlalchemy import select

from backend.models.job import Job, JobStatus, JobType
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


class JobService:
    """Service for managing database-backed jobs."""

    async def create_job(
        self,
        job_type: JobType,
        owner_did: str,
        initial_message: str = "job created",
    ) -> str:
        """Create a new job and return its ID."""
        async with db_session() as db:
            job = Job(
                type=job_type.value,
                owner_did=owner_did,
                status=JobStatus.PENDING.value,
                message=initial_message,
                progress_pct=0.0,
            )
            db.add(job)
            await db.commit()
            await db.refresh(job)
            return job.id

    async def update_progress(
        self,
        job_id: str,
        status: JobStatus,
        message: str,
        progress_pct: float | None = None,
        phase: str | None = None,
        result: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> None:
        """Update job progress."""
        async with db_session() as db:
            stmt = select(Job).where(Job.id == job_id)
            result_db = await db.execute(stmt)
            job = result_db.scalar_one_or_none()

            if not job:
                logger.warning(f"attempted to update unknown job: {job_id}")
                return

            job.status = status.value
            job.message = message
            if progress_pct is not None:
                job.progress_pct = progress_pct
            if phase:
                job.phase = phase
            if result:
                job.result = {**(job.result or {}), **result}
            if error:
                job.error = error

            if status in (JobStatus.COMPLETED, JobStatus.FAILED):
                job.completed_at = datetime.now(UTC)

            await db.commit()

            # log significant updates
            if status in (JobStatus.COMPLETED, JobStatus.FAILED) or (
                progress_pct and int(progress_pct) % 25 == 0
            ):
                logfire.info(
                    "job updated",
                    job_id=job_id,
                    status=status.value,
                    progress=progress_pct,
                )

    async def get_job(self, job_id: str) -> Job | None:
        """Get job by ID."""
        async with db_session() as db:
            stmt = select(Job).where(Job.id == job_id)
            result = await db.execute(stmt)
            return result.scalar_one_or_none()


job_service = JobService()
