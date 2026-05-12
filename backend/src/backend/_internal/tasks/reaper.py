"""stuck-upload reaper.

a periodic docket task that closes the loop on upload jobs which sit in
`status = 'processing'` past a wall-clock budget. without it, a worker
that dies between staging an R2 blob and finalizing a track row leaves
the user's frontend spinning on "uploading to storage… 100%" forever.

see docs/internal/retrospectives/2026-05-10-worker-oom-loop-streaming.md
for the incident that motivated this task.

design

- **threshold 10 minutes**. heartbeats inside `_signed_streaming_post`
  and the transcoder client tick `jobs.updated_at` every ~5s while a
  task is alive, so 10 min of staleness genuinely means dead/wedged,
  not "transcoding a big file." filtering on `updated_at` (not
  `created_at`) is the safety against false-positives.
- **atomic claim**: a single `UPDATE ... WHERE id IN (SELECT ... FOR
  UPDATE SKIP LOCKED) RETURNING ...` performs the row lock + state
  transition in one statement. concurrent reaper runs (which docket
  shouldn't produce today, but could under future multi-worker setups
  or split-brain edge cases) get empty RETURNING sets — no double-DM,
  no double-cleanup.
- **ownership-guarded R2 cleanup**: before deleting the staged blob,
  the reaper queries `tracks` for any row referencing the same
  `file_id` as `Track.file_id` OR `Track.original_file_id`. if a track
  row owns the blob (worker hung AFTER `_create_records` committed,
  e.g. during a slow `_schedule_post_upload`), we skip the delete.
  this is the load-bearing protection against deleting live audio.
- **notification**: one batched bsky DM per reaper run summarizing
  affected users, not one per stuck job — avoids DM spam in a system-
  wide outage like 2026-05-06 (which would have fired 9 separate DMs).
"""

import logging
from datetime import UTC, datetime, timedelta

import logfire
from docket import Perpetual
from sqlalchemy import or_, select, update

from backend._internal.notifications import notification_service
from backend.models import Artist, Track
from backend.models.job import Job, JobStatus, JobType
from backend.storage import storage
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)

# how long a job can sit in `processing` before we call it stuck. with the
# heartbeat tickers inside `_signed_streaming_post` and the transcoder client,
# a live task updates `updated_at` every ~5s — so 10 minutes of staleness
# is a 120x signal-to-noise ratio over the heartbeat cadence.
STUCK_UPLOAD_THRESHOLD = timedelta(minutes=10)


async def reap_stuck_uploads(
    perpetual: Perpetual = Perpetual(every=timedelta(seconds=60), automatic=True),  # noqa: B008
) -> None:
    """find upload jobs stuck in `processing` and fail them.

    runs automatically every 60 seconds via docket's Perpetual scheduler.
    """
    cutoff = datetime.now(UTC) - STUCK_UPLOAD_THRESHOLD
    now = datetime.now(UTC)
    error_message = (
        f"upload timed out — task did not complete in "
        f"{int(STUCK_UPLOAD_THRESHOLD.total_seconds() / 60)} minutes; "
        f"please re-upload"
    )

    async with db_session() as db:
        # atomic claim: single statement locks and transitions the rows so
        # concurrent reaper runs cannot race. RETURNING gives us the rows
        # this run actually claimed (others get empty sets).
        stuck_ids = (
            select(Job.id)
            .where(
                Job.type == JobType.UPLOAD.value,
                Job.status == JobStatus.PROCESSING.value,
                Job.updated_at < cutoff,
            )
            .with_for_update(skip_locked=True)
        )
        result = await db.execute(
            update(Job)
            .where(Job.id.in_(stuck_ids))
            .values(
                status=JobStatus.FAILED.value,
                message="upload failed",
                error=error_message,
                completed_at=now,
                updated_at=now,
            )
            .returning(Job)
        )
        reaped = list(result.scalars().all())
        await db.commit()

        if not reaped:
            return

        with logfire.span(
            "reap_stuck_uploads",
            stuck_count=len(reaped),
            threshold_minutes=int(STUCK_UPLOAD_THRESHOLD.total_seconds() / 60),
        ):
            logfire.warning(
                "reaped {count} stuck upload jobs",
                count=len(reaped),
            )

            for job in reaped:
                await _maybe_cleanup_staged_blob(db, job)

            owner_dids = {job.owner_did for job in reaped}
            handles = await _resolve_owner_handles(db, owner_dids)
            await notification_service.send_reaper_notification(
                reaped_count=len(reaped),
                affected_handles=handles,
                threshold_minutes=int(STUCK_UPLOAD_THRESHOLD.total_seconds() / 60),
                job_ids=[j.id for j in reaped],
            )


async def _maybe_cleanup_staged_blob(db, job: Job) -> None:
    """delete the staged R2 blob ONLY if no track row references it.

    a job can stall in `processing` after `_create_records` has already
    committed a `Track` row but before `_schedule_post_upload` finishes.
    in that window, `job.file_id` is the live track audio (web-playable
    uploads) or the lossless original (transcoded uploads, where it's
    `Track.original_file_id`). deleting it would 404 playback for a
    track that the user successfully published.

    we check both columns because the staged blob can end up as either,
    depending on whether the upload was web-playable or lossless.
    """
    if not job.file_id or not job.file_type:
        logfire.info(
            "skipping R2 cleanup for stuck job (no cleanup hints)",
            job_id=job.id,
        )
        return

    # ownership check — is the staged blob now part of a live track?
    owner = await db.execute(
        select(Track.id)
        .where(
            or_(
                Track.file_id == job.file_id,
                Track.original_file_id == job.file_id,
            )
        )
        .limit(1)
    )
    if owner.scalar_one_or_none() is not None:
        logfire.info(
            "skipping R2 cleanup for stuck job (blob is live track audio)",
            job_id=job.id,
            file_id=job.file_id,
        )
        return

    try:
        if job.is_gated:
            await storage.delete_gated(job.file_id, job.file_type)
        else:
            await storage.delete(job.file_id, job.file_type)
    except Exception as e:
        logfire.warning(
            "R2 cleanup failed for stuck job (job already marked failed)",
            job_id=job.id,
            file_id=job.file_id,
            error=str(e),
        )


async def _resolve_owner_handles(db, dids: set[str]) -> list[str]:
    """map owner DIDs to handles via the artists table. unresolved DIDs
    pass through as the DID so the DM never silently drops a user."""
    if not dids:
        return []
    rows = await db.execute(
        select(Artist.did, Artist.handle).where(Artist.did.in_(list(dids)))
    )
    by_did = dict(rows.all())
    return [by_did.get(d, d) for d in dids]
