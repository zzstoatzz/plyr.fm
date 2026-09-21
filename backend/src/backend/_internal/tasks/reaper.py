"""stuck-upload reaper.

a periodic docket task that closes the loop on upload jobs which stop before
or during worker processing. without it, a request or worker that dies after
creating the job can leave the user's frontend spinning forever.

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
- **ownership-guarded R2 cleanup**: `storage.discard_staged` refuses to
  delete bytes any live row references (a track that committed before
  the worker hung, or another upload of the same content hash). this is
  the load-bearing protection against deleting live audio.
- **abandon before delete**: the failed status commits before any byte
  is deleted, and `_create_records` locks the same row before it
  publishes, so a paused worker that wakes up after the reaper cannot
  publish a track whose bytes are gone.
- **tombstones**: a failed upload job keeps its cleanup hints, and
  `sweep_abandoned_uploads` re-sweeps recent ones. one successful
  delete proves nothing — a copy the worker issued before it stalled
  can land afterwards, and R2 can be down when the reaper runs.
- **notification**: one batched bsky DM per reaper run summarizing
  affected users, not one per stuck job — avoids DM spam in a system-
  wide outage like 2026-05-06 (which would have fired 9 separate DMs).
"""

import logging
from datetime import UTC, datetime, timedelta

import logfire
from docket import Perpetual
from sqlalchemy import and_, or_, select, update

from backend._internal.jobs import TERMINAL_STATUSES
from backend._internal.notifications import notification_service
from backend.models import Artist
from backend.models.job import Job, JobStatus, JobType
from backend.storage import storage
from backend.storage.keys import StagedUploadKey
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)

# how long a job can stop before or during worker processing before we call it
# stuck. with the
# heartbeat tickers inside `_signed_streaming_post` and the transcoder client,
# a live task updates `updated_at` every ~5s — so 10 minutes of staleness
# is a 120x signal-to-noise ratio over the heartbeat cadence.
STUCK_UPLOAD_THRESHOLD = timedelta(minutes=10)


async def reap_stuck_uploads(
    perpetual: Perpetual = Perpetual(every=timedelta(seconds=60), automatic=True),  # noqa: B008
) -> None:
    """find upload jobs stuck before or during worker processing and fail them.

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
                or_(
                    Job.status == JobStatus.PROCESSING.value,
                    and_(
                        Job.status == JobStatus.PENDING.value,
                        or_(Job.phase.is_(None), Job.phase != "transfer"),
                    ),
                ),
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
                await _sweep_abandoned_media(job)

            owner_dids = {job.owner_did for job in reaped}
            handles = await _resolve_owner_handles(db, owner_dids)
            await notification_service.send_reaper_notification(
                reaped_count=len(reaped),
                affected_handles=handles,
                threshold_minutes=int(STUCK_UPLOAD_THRESHOLD.total_seconds() / 60),
                job_ids=[j.id for j in reaped],
            )


ABANDONED_TRANSFER_THRESHOLD = timedelta(hours=24)


async def reap_abandoned_transfers(
    perpetual: Perpetual = Perpetual(every=timedelta(minutes=30), automatic=True),  # noqa: B008
) -> None:
    """close resumable upload sessions nobody has sent a part to in a day.

    a session sits in `pending` / phase `transfer` while the browser sends
    parts (each part heartbeats `updated_at`); a closed tab leaves it there
    with an open R2 multipart upload. R2 aborts those itself after 7 days;
    this just makes the job row say so sooner and stops the client resuming
    into a session that will never finish. no notification — the user
    walked away, nothing failed.
    """
    cutoff = datetime.now(UTC) - ABANDONED_TRANSFER_THRESHOLD
    now = datetime.now(UTC)
    async with db_session() as db:
        stale_ids = (
            select(Job.id)
            .where(
                Job.type == JobType.UPLOAD.value,
                Job.status == JobStatus.PENDING.value,
                Job.phase == "transfer",
                Job.updated_at < cutoff,
            )
            .with_for_update(skip_locked=True)
        )
        result = await db.execute(
            update(Job)
            .where(Job.id.in_(stale_ids))
            .values(
                status=JobStatus.FAILED.value,
                message="upload failed",
                error="upload session expired — please re-upload",
                completed_at=now,
                updated_at=now,
            )
            .returning(Job)
        )
        abandoned = list(result.scalars().all())
        await db.commit()

    for job in abandoned:
        transfer = (job.result or {}).get("transfer") or {}
        try:
            staged = StagedUploadKey(
                upload_id=job.id, extension=str(transfer["extension"])
            )
            await storage.abort_staged_upload(staged, str(transfer["multipart_id"]))
        except Exception as e:
            logfire.warning(
                "could not abort abandoned multipart upload",
                job_id=job.id,
                error=str(e),
            )
    if abandoned:
        logfire.info("reaped abandoned upload sessions", count=len(abandoned))


ABANDONED_MEDIA_RETENTION = timedelta(days=7)


async def sweep_abandoned_uploads(
    perpetual: Perpetual = Perpetual(every=timedelta(minutes=30), automatic=True),  # noqa: B008
) -> None:
    """re-sweep the media of recently failed upload jobs.

    the reaper's own delete is one attempt. this keeps the abandoned key
    discoverable for `ABANDONED_MEDIA_RETENTION` and deletes again on every
    run, so a delete that failed, or a promotion the stalled worker had
    already issued, still ends with the bytes gone.
    """
    cutoff = datetime.now(UTC) - ABANDONED_MEDIA_RETENTION
    async with db_session() as db:
        abandoned = (
            (
                await db.execute(
                    select(Job).where(
                        Job.type == JobType.UPLOAD.value,
                        Job.status == JobStatus.FAILED.value,
                        Job.file_id.is_not(None),
                        Job.completed_at > cutoff,
                    )
                )
            )
            .scalars()
            .all()
        )
    for job in abandoned:
        await _sweep_abandoned_media(job)
    if abandoned:
        logfire.info("swept abandoned upload media", count=len(abandoned))


async def _sweep_abandoned_media(job: Job) -> None:
    """delete an abandoned upload's bytes unless a live row references them.

    `discard_staged` is the guard: a job can stall in `processing` after
    `_create_records` committed a `Track` row, and the same content hash
    can be another artist's published audio. a resumable session's staged
    object is deleted too, in case the job was abandoned before promotion.
    """
    if not job.file_id or not job.file_type:
        logfire.info(
            "skipping R2 cleanup for stuck job (no cleanup hints)",
            job_id=job.id,
        )
        return

    try:
        if transfer := (job.result or {}).get("transfer"):
            await storage.delete_staged(
                StagedUploadKey(upload_id=job.id, extension=str(transfer["extension"]))
            )
        if claimant := await _live_claimant(job):
            logfire.info(
                "keeping abandoned upload media, a live upload claims it",
                job_id=job.id,
                file_id=job.file_id,
                claimed_by=claimant,
            )
            return
        deleted = await storage.discard_staged(
            job.file_id, job.file_type, gated=bool(job.is_gated)
        )
        logfire.info(
            "abandoned upload media swept",
            job_id=job.id,
            file_id=job.file_id,
            deleted=deleted,
        )
    except Exception as e:
        logfire.warning(
            "R2 cleanup failed for abandoned job; it will be swept again",
            job_id=job.id,
            file_id=job.file_id,
            error=str(e),
        )


async def _live_claimant(job: Job) -> str | None:
    """the id of a pending or processing job whose hints name the same key.

    a re-upload of the file that just timed out hashes to the same content
    key, and it writes its hints before its bytes, so an unfinished job with
    these hints means the bytes now belong to that upload.
    """
    async with db_session() as db:
        return await db.scalar(
            select(Job.id)
            .where(
                Job.file_id == job.file_id,
                Job.id != job.id,
                Job.status.not_in(TERMINAL_STATUSES),
            )
            .limit(1)
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
