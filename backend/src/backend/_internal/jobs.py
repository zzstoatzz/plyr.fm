"""Database-backed job tracking service."""

import logging
from datetime import UTC, datetime
from typing import Any

import logfire
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.job import Job, JobStatus, JobType
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)

TERMINAL_STATUSES = (JobStatus.COMPLETED.value, JobStatus.FAILED.value)


class JobService:
    """Service for managing database-backed jobs."""

    async def create_job(
        self,
        job_type: JobType,
        owner_did: str,
        initial_message: str = "job created",
        *,
        file_id: str | None = None,
        file_type: str | None = None,
        is_gated: bool | None = None,
    ) -> str:
        """Create a new job and return its ID.

        for upload jobs, callers should pass `file_id`, `file_type`, and
        `is_gated` so the stuck-upload reaper can clean up the staged R2
        blob from the right bucket if the job stalls. other job types
        (export, pds_save) leave them None.
        """
        async with db_session() as db:
            job = Job(
                type=job_type.value,
                owner_did=owner_did,
                status=JobStatus.PENDING.value,
                message=initial_message,
                progress_pct=0.0,
                file_id=file_id,
                file_type=file_type,
                is_gated=is_gated,
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
    ) -> bool:
        """Update job progress.

        returns False when the job is already completed or failed: terminal
        states are terminal, so a worker that wakes up after the reaper
        abandoned its job cannot write it back to life.
        """
        async with db_session() as db:
            stmt = select(Job).where(Job.id == job_id).with_for_update()
            result_db = await db.execute(stmt)
            job = result_db.scalar_one_or_none()

            if not job:
                logger.warning(f"attempted to update unknown job: {job_id}")
                return False

            if job.status in TERMINAL_STATUSES:
                logfire.warning(
                    "ignoring progress update on a finished job",
                    job_id=job_id,
                    current_status=job.status,
                    attempted_status=status.value,
                )
                return False

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
            return True

    async def lock_for_publication(self, db: AsyncSession, job_id: str) -> bool:
        """hold the job row for the rest of ``db``'s transaction and report
        whether the job is still ours to finish.

        the stuck-upload reaper abandons a job with ``FOR UPDATE SKIP LOCKED``
        and commits before it deletes any bytes, so whichever of the two
        transactions takes this lock first decides: a reaped job cannot publish,
        and a job that is publishing cannot be reaped underneath it.
        """
        job = (
            await db.execute(select(Job).where(Job.id == job_id).with_for_update())
        ).scalar_one_or_none()
        if job is None:
            logger.warning(f"publishing without a job row: {job_id}")
            return True
        if job.status in TERMINAL_STATUSES:
            logfire.warning(
                "refusing to publish an abandoned job",
                job_id=job_id,
                current_status=job.status,
            )
            return False
        return True

    async def set_cleanup_hints(
        self,
        job_id: str,
        *,
        file_id: str,
        file_type: str,
        is_gated: bool,
    ) -> None:
        """Populate the staged-media cleanup hints on an existing job.

        called by the upload handler once `stage_audio_to_storage` has
        returned a file_id. these fields are what the stuck-upload reaper
        reads to delete the staged R2 blob from the right bucket before
        marking a stalled job failed.
        """
        async with db_session() as db:
            stmt = select(Job).where(Job.id == job_id)
            db_result = await db.execute(stmt)
            job = db_result.scalar_one_or_none()
            if not job:
                logger.warning(
                    f"attempted to set cleanup hints on unknown job: {job_id}"
                )
                return
            job.file_id = file_id
            job.file_type = file_type
            job.is_gated = is_gated
            await db.commit()

    async def heartbeat(self, job_id: str) -> None:
        """tick `updated_at` on a still-active job without changing any other state.

        called from inside long phases (PDS streaming, transcode chunk loop)
        so the stuck-upload reaper can trust `updated_at` as a liveness signal:
        an actively-running task always has a fresh `updated_at`, and only a
        truly stalled task drifts past the reaper's threshold.

        cheap on purpose — single `UPDATE ... WHERE id = ?` with no SELECT.
        callers should already throttle (every N bytes or every T seconds);
        unthrottled callsites would hammer postgres.
        """
        async with db_session() as db:
            await db.execute(
                update(Job)
                .where(Job.id == job_id, Job.status.not_in(TERMINAL_STATUSES))
                .values(updated_at=datetime.now(UTC))
            )
            await db.commit()

    async def get_job(self, job_id: str) -> Job | None:
        """Get job by ID."""
        async with db_session() as db:
            stmt = select(Job).where(Job.id == job_id)
            result = await db.execute(stmt)
            return result.scalar_one_or_none()


job_service = JobService()
