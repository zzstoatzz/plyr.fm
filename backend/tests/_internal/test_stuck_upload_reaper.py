"""tests for the stuck-upload reaper.

regression coverage for 2026-05-10 — without a reaper, an upload job
left stuck in `status = processing` (e.g. worker died mid-task) sits
there forever, the user's frontend spins, and we have no way to
notice short of the user reporting it.

ownership-guard tests (see test_reaper_skips_r2_delete_if_*) are the
load-bearing protection against deleting media that a successfully-
committed Track row now references. without that guard the reaper could
404 a user's just-published audio if the worker hung in a post-DB phase.

see docs/internal/retrospectives/2026-05-10-worker-oom-loop-streaming.md
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.tasks.reaper import (
    STUCK_UPLOAD_THRESHOLD,
    reap_stuck_uploads,
)
from backend.models import Artist, Track
from backend.models.job import Job, JobStatus, JobType


def _stuck_in_past(minutes_ago: int) -> datetime:
    return datetime.now(UTC) - timedelta(minutes=minutes_ago)


def _minutes_past_threshold(extra: int = 5) -> int:
    return int(STUCK_UPLOAD_THRESHOLD.total_seconds() / 60) + extra


async def _seed_artist(db: AsyncSession, *, did: str, handle: str) -> Artist:
    artist = Artist(did=did, handle=handle, display_name=handle)
    db.add(artist)
    await db.commit()
    return artist


async def _seed_upload_job(
    db: AsyncSession,
    *,
    owner_did: str,
    status: JobStatus = JobStatus.PROCESSING,
    updated_at: datetime,
    file_id: str | None = "abc123",
    file_type: str | None = "mp3",
    is_gated: bool | None = False,
) -> Job:
    job = Job(
        type=JobType.UPLOAD.value,
        status=status.value,
        owner_did=owner_did,
        message="uploading to storage...",
        progress_pct=100.0,
        file_id=file_id,
        file_type=file_type,
        is_gated=is_gated,
        created_at=updated_at,
        updated_at=updated_at,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


async def _seed_track(
    db: AsyncSession,
    *,
    title: str,
    file_id: str,
    file_type: str,
    artist_did: str,
    original_file_id: str | None = None,
    original_file_type: str | None = None,
) -> Track:
    track = Track(
        title=title,
        file_id=file_id,
        file_type=file_type,
        artist_did=artist_did,
        r2_url=f"https://audio.plyr.fm/audio/{file_id}.{file_type}",
        original_file_id=original_file_id,
        original_file_type=original_file_type,
    )
    db.add(track)
    await db.commit()
    return track


async def test_reaper_fails_stuck_upload_and_deletes_orphan_blob(
    db_session: AsyncSession,
) -> None:
    """central case: blob is genuinely orphaned (no track references it),
    so we mark failed AND delete the staged R2 object."""
    await _seed_artist(db_session, did="did:plc:stuck", handle="stuck.test")
    stuck = await _seed_upload_job(
        db_session,
        owner_did="did:plc:stuck",
        updated_at=_stuck_in_past(_minutes_past_threshold()),
    )

    with (
        patch(
            "backend._internal.tasks.reaper.storage.delete",
            new_callable=AsyncMock,
        ) as mock_delete,
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ) as mock_notify,
    ):
        await reap_stuck_uploads()

    mock_delete.assert_awaited_once_with("abc123", "mp3")
    mock_notify.assert_awaited_once()
    notify_kwargs = mock_notify.await_args.kwargs
    assert notify_kwargs["reaped_count"] == 1
    assert notify_kwargs["affected_handles"] == ["stuck.test"]
    assert notify_kwargs["job_ids"] == [stuck.id]

    await db_session.refresh(stuck)
    assert stuck.status == JobStatus.FAILED.value
    assert stuck.error is not None
    assert "timed out" in stuck.error
    assert stuck.completed_at is not None


async def test_reaper_leaves_recent_processing_jobs_alone(
    db_session: AsyncSession,
) -> None:
    """false-positive safety. a job that's still ticking forward must not be reaped."""
    await _seed_artist(db_session, did="did:plc:fresh", handle="fresh.test")
    fresh = await _seed_upload_job(
        db_session,
        owner_did="did:plc:fresh",
        updated_at=_stuck_in_past(2),  # well under threshold
    )

    with (
        patch(
            "backend._internal.tasks.reaper.storage.delete",
            new_callable=AsyncMock,
        ) as mock_delete,
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ) as mock_notify,
    ):
        await reap_stuck_uploads()

    mock_delete.assert_not_awaited()
    mock_notify.assert_not_awaited()

    await db_session.refresh(fresh)
    assert fresh.status == JobStatus.PROCESSING.value


async def test_reaper_skips_r2_delete_when_blob_is_live_track_audio(
    db_session: AsyncSession,
) -> None:
    """LOAD-BEARING: a worker that hung AFTER `_create_records` committed
    leaves a job in `processing` but the track row exists and references
    `job.file_id` as `Track.file_id`. the reaper must NOT delete the
    blob — that would 404 playback for a successfully-published track.

    we still mark the job failed (frontend spinner closes; user re-uploads
    or notices the duplicate via the track listing) but the live audio is
    preserved.
    """
    await _seed_artist(db_session, did="did:plc:hung", handle="hung.test")
    # the track was committed by `_create_records`; its file_id matches the
    # job's staged file_id (web-playable upload path).
    await _seed_track(
        db_session,
        title="published mid-hang",
        file_id="livefile123",
        file_type="mp3",
        artist_did="did:plc:hung",
    )
    stuck = await _seed_upload_job(
        db_session,
        owner_did="did:plc:hung",
        updated_at=_stuck_in_past(_minutes_past_threshold()),
        file_id="livefile123",
        file_type="mp3",
    )

    with (
        patch(
            "backend._internal.tasks.reaper.storage.delete",
            new_callable=AsyncMock,
        ) as mock_delete,
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ),
    ):
        await reap_stuck_uploads()

    # the load-bearing assertion: NO R2 delete.
    mock_delete.assert_not_awaited()

    # but the job is still marked failed so the user's frontend stops spinning.
    await db_session.refresh(stuck)
    assert stuck.status == JobStatus.FAILED.value


async def test_reaper_skips_r2_delete_when_blob_is_lossless_original(
    db_session: AsyncSession,
) -> None:
    """lossless upload variant of the previous test. for AIFF/FLAC the
    staged blob ends up as `Track.original_file_id`, not `Track.file_id`
    (the playable transcode gets `file_id`). the ownership guard has to
    check both columns.
    """
    await _seed_artist(db_session, did="did:plc:lossless", handle="lossless.test")
    await _seed_track(
        db_session,
        title="published lossless",
        file_id="transcoded456",
        file_type="mp3",
        artist_did="did:plc:lossless",
        original_file_id="lossless_orig789",
        original_file_type="aiff",
    )
    stuck = await _seed_upload_job(
        db_session,
        owner_did="did:plc:lossless",
        updated_at=_stuck_in_past(_minutes_past_threshold()),
        file_id="lossless_orig789",
        file_type="aiff",
    )

    with (
        patch(
            "backend._internal.tasks.reaper.storage.delete",
            new_callable=AsyncMock,
        ) as mock_delete,
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ),
    ):
        await reap_stuck_uploads()

    mock_delete.assert_not_awaited()
    await db_session.refresh(stuck)
    assert stuck.status == JobStatus.FAILED.value


async def test_reaper_uses_delete_gated_for_gated_uploads(
    db_session: AsyncSession,
) -> None:
    """gated tracks live in a separate R2 bucket; cleanup must route correctly."""
    await _seed_artist(db_session, did="did:plc:gated", handle="gated.test")
    gated = await _seed_upload_job(
        db_session,
        owner_did="did:plc:gated",
        updated_at=_stuck_in_past(_minutes_past_threshold()),
        is_gated=True,
    )

    with (
        patch(
            "backend._internal.tasks.reaper.storage.delete",
            new_callable=AsyncMock,
        ) as mock_delete,
        patch(
            "backend._internal.tasks.reaper.storage.delete_gated",
            new_callable=AsyncMock,
        ) as mock_delete_gated,
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ),
    ):
        await reap_stuck_uploads()

    mock_delete.assert_not_awaited()
    mock_delete_gated.assert_awaited_once_with("abc123", "mp3")
    await db_session.refresh(gated)
    assert gated.status == JobStatus.FAILED.value


async def test_reaper_handles_job_without_cleanup_hints(
    db_session: AsyncSession,
) -> None:
    """rows that pre-date the cleanup-hints migration must still get marked
    failed; R2 cleanup is skipped (best effort)."""
    await _seed_artist(db_session, did="did:plc:legacy", handle="legacy.test")
    legacy = await _seed_upload_job(
        db_session,
        owner_did="did:plc:legacy",
        updated_at=_stuck_in_past(_minutes_past_threshold()),
        file_id=None,
        file_type=None,
        is_gated=None,
    )

    with (
        patch(
            "backend._internal.tasks.reaper.storage.delete",
            new_callable=AsyncMock,
        ) as mock_delete,
        patch(
            "backend._internal.tasks.reaper.storage.delete_gated",
            new_callable=AsyncMock,
        ) as mock_delete_gated,
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ) as mock_notify,
    ):
        await reap_stuck_uploads()

    mock_delete.assert_not_awaited()
    mock_delete_gated.assert_not_awaited()
    mock_notify.assert_awaited_once()
    await db_session.refresh(legacy)
    assert legacy.status == JobStatus.FAILED.value


async def test_reaper_sends_one_batched_dm_for_multiple_stuck_jobs(
    db_session: AsyncSession,
) -> None:
    """May 6 scenario: 9 stuck jobs across 3 users → ONE DM, not 9.

    avoids spamming the admin during a system-wide failure (and prevents
    rate-limited bsky DMs from dropping the notification entirely).
    """
    await _seed_artist(db_session, did="did:plc:a", handle="alice.test")
    await _seed_artist(db_session, did="did:plc:b", handle="bob.test")

    minutes_past = _minutes_past_threshold()
    for did in ("did:plc:a", "did:plc:a", "did:plc:b"):
        await _seed_upload_job(
            db_session,
            owner_did=did,
            updated_at=_stuck_in_past(minutes_past),
        )

    with (
        patch(
            "backend._internal.tasks.reaper.storage.delete",
            new_callable=AsyncMock,
        ),
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ) as mock_notify,
    ):
        await reap_stuck_uploads()

    mock_notify.assert_awaited_once()
    kwargs = mock_notify.await_args.kwargs
    assert kwargs["reaped_count"] == 3
    assert sorted(kwargs["affected_handles"]) == ["alice.test", "bob.test"]
    assert len(kwargs["job_ids"]) == 3


async def test_reaper_marks_failed_even_when_r2_delete_throws(
    db_session: AsyncSession,
) -> None:
    """R2 cleanup is best-effort — a transient delete failure must not
    prevent us from marking the user's job failed, otherwise the user
    keeps seeing the indefinite progress bar.
    """
    await _seed_artist(db_session, did="did:plc:r2fail", handle="r2fail.test")
    job = await _seed_upload_job(
        db_session,
        owner_did="did:plc:r2fail",
        updated_at=_stuck_in_past(_minutes_past_threshold()),
    )

    with (
        patch(
            "backend._internal.tasks.reaper.storage.delete",
            new_callable=AsyncMock,
            side_effect=RuntimeError("R2 temporarily unavailable"),
        ),
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ),
    ):
        await reap_stuck_uploads()

    await db_session.refresh(job)
    assert job.status == JobStatus.FAILED.value


async def test_reaper_second_run_does_not_reclaim_already_failed_jobs(
    db_session: AsyncSession,
) -> None:
    """the atomic UPDATE ... WHERE status='processing' RETURNING ... shape
    means once a row is failed, subsequent reaper runs do not see it again.
    proves the claim is idempotent even if two reapers race (the second one
    gets an empty RETURNING set)."""
    await _seed_artist(db_session, did="did:plc:idem", handle="idem.test")
    job = await _seed_upload_job(
        db_session,
        owner_did="did:plc:idem",
        updated_at=_stuck_in_past(_minutes_past_threshold()),
    )

    with (
        patch(
            "backend._internal.tasks.reaper.storage.delete",
            new_callable=AsyncMock,
        ),
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ) as mock_notify,
    ):
        await reap_stuck_uploads()
        # second run: no rows should match status='processing' anymore
        await reap_stuck_uploads()

    # only one DM total — the second run found nothing to reap.
    mock_notify.assert_awaited_once()
    await db_session.refresh(job)
    assert job.status == JobStatus.FAILED.value
