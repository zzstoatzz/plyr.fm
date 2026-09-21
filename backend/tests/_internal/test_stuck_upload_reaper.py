"""tests for the stuck-upload reaper.

regression coverage for 2026-05-10 — without a reaper, an upload job
left stuck before or during worker processing sits there forever, the user's
frontend spins, and we have no way to notice short of the user reporting it.

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
    ABANDONED_MEDIA_RETENTION,
    STUCK_UPLOAD_THRESHOLD,
    reap_abandoned_transfers,
    reap_stuck_uploads,
    sweep_abandoned_uploads,
)
from backend.models import Artist, Track
from backend.models.job import Job, JobStatus, JobType
from backend.storage.keys import StagedUploadKey


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
    phase: str | None = None,
    updated_at: datetime,
    file_id: str | None = "abc123",
    file_type: str | None = "mp3",
    is_gated: bool | None = False,
) -> Job:
    job = Job(
        type=JobType.UPLOAD.value,
        status=status.value,
        phase=phase,
        owner_did=owner_did,
        message="uploading to storage...",
        progress_pct=100.0,
        file_id=file_id,
        file_type=file_type,
        is_gated=is_gated,
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
            "backend._internal.tasks.reaper.storage.discard_staged",
            new_callable=AsyncMock,
        ) as mock_discard,
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ) as mock_notify,
    ):
        await reap_stuck_uploads()

    mock_discard.assert_awaited_once_with("abc123", "mp3", gated=False)
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


async def test_reaper_fails_stale_pending_job_without_phase(
    db_session: AsyncSession,
) -> None:
    await _seed_artist(db_session, did="did:plc:pending", handle="pending.test")
    pending = await _seed_upload_job(
        db_session,
        owner_did="did:plc:pending",
        status=JobStatus.PENDING,
        updated_at=_stuck_in_past(_minutes_past_threshold()),
        file_id=None,
        file_type=None,
        is_gated=None,
    )
    transfer = await _seed_upload_job(
        db_session,
        owner_did="did:plc:pending",
        status=JobStatus.PENDING,
        phase="transfer",
        updated_at=_stuck_in_past(_minutes_past_threshold()),
        file_id=None,
        file_type=None,
        is_gated=None,
    )

    with (
        patch(
            "backend._internal.tasks.reaper.storage.discard_staged",
            new_callable=AsyncMock,
        ) as mock_discard,
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ) as mock_notify,
    ):
        await reap_stuck_uploads()

    mock_discard.assert_not_awaited()
    mock_notify.assert_awaited_once()
    await db_session.refresh(pending)
    await db_session.refresh(transfer)
    assert pending.status == JobStatus.FAILED.value
    assert transfer.status == JobStatus.PENDING.value


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


async def test_reaper_discards_gated_uploads_from_the_private_bucket(
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
            "backend._internal.tasks.reaper.storage.discard_staged",
            new_callable=AsyncMock,
        ) as mock_discard,
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ),
    ):
        await reap_stuck_uploads()

    mock_discard.assert_awaited_once_with("abc123", "mp3", gated=True)
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
            "backend._internal.tasks.reaper.storage.discard_staged",
            new_callable=AsyncMock,
        ) as mock_discard,
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ) as mock_notify,
    ):
        await reap_stuck_uploads()

    mock_discard.assert_not_awaited()
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
            "backend._internal.tasks.reaper.storage.discard_staged",
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
            "backend._internal.tasks.reaper.storage.discard_staged",
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
    """the atomic UPDATE ... WHERE status IN active statuses RETURNING ... shape
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
            "backend._internal.tasks.reaper.storage.discard_staged",
            new_callable=AsyncMock,
        ),
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ) as mock_notify,
    ):
        await reap_stuck_uploads()
        # second run: no rows should match an active status anymore
        await reap_stuck_uploads()

    # only one DM total — the second run found nothing to reap.
    mock_notify.assert_awaited_once()
    await db_session.refresh(job)
    assert job.status == JobStatus.FAILED.value


async def _seed_failed_job(
    db: AsyncSession,
    *,
    completed_ago: timedelta,
    file_id: str | None = "abandoned1",
    result: dict | None = None,
) -> Job:
    done = datetime.now(UTC) - completed_ago
    job = Job(
        type=JobType.UPLOAD.value,
        status=JobStatus.FAILED.value,
        owner_did="did:plc:sweep",
        message="upload failed",
        file_id=file_id,
        file_type="wav" if file_id else None,
        is_gated=False,
        result=result,
        updated_at=done,
        completed_at=done,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


async def test_sweep_revisits_recently_failed_uploads_only(
    db_session: AsyncSession,
) -> None:
    """a failed job with cleanup hints is the tombstone. it is swept again on
    every run inside the retention window — one successful delete is not
    proof, a copy the stalled worker issued can still land — and left alone
    once the window has passed."""
    recent = await _seed_failed_job(db_session, completed_ago=timedelta(hours=1))
    await _seed_failed_job(
        db_session, completed_ago=ABANDONED_MEDIA_RETENTION + timedelta(hours=1)
    )
    await _seed_failed_job(db_session, completed_ago=timedelta(hours=1), file_id=None)
    completed = Job(
        type=JobType.UPLOAD.value,
        status=JobStatus.COMPLETED.value,
        owner_did="did:plc:sweep",
        file_id="published1",
        file_type="wav",
        completed_at=datetime.now(UTC),
    )
    db_session.add(completed)
    await db_session.commit()

    with patch(
        "backend._internal.tasks.reaper.storage.discard_staged",
        new_callable=AsyncMock,
    ) as mock_discard:
        await sweep_abandoned_uploads()
        await sweep_abandoned_uploads()

    assert mock_discard.await_args_list == [
        (("abandoned1", "wav"), {"gated": False}),
        (("abandoned1", "wav"), {"gated": False}),
    ]
    await db_session.refresh(recent)
    assert recent.status == JobStatus.FAILED.value


async def test_sweep_retries_a_delete_that_failed(
    db_session: AsyncSession,
) -> None:
    """T9: R2 was unavailable when the reaper ran. the job stays failed and
    the next sweep deletes the bytes."""
    await _seed_failed_job(db_session, completed_ago=timedelta(minutes=5))

    with patch(
        "backend._internal.tasks.reaper.storage.discard_staged",
        new_callable=AsyncMock,
        side_effect=[RuntimeError("R2 temporarily unavailable"), True],
    ) as mock_discard:
        await sweep_abandoned_uploads()
        await sweep_abandoned_uploads()

    assert mock_discard.await_count == 2


async def test_sweep_deletes_a_resumable_sessions_staged_object_too(
    db_session: AsyncSession,
) -> None:
    """hints are written before promotion, so an abandoned resumable upload
    may still hold its bytes under `staged/<upload_id>.<ext>`."""
    job = await _seed_failed_job(
        db_session,
        completed_ago=timedelta(minutes=5),
        result={"transfer": {"multipart_id": "mp-1", "extension": "wav"}},
    )

    with (
        patch(
            "backend._internal.tasks.reaper.storage.discard_staged",
            new_callable=AsyncMock,
        ),
        patch(
            "backend._internal.tasks.reaper.storage.delete_staged",
            new_callable=AsyncMock,
        ) as mock_delete_staged,
    ):
        await sweep_abandoned_uploads()

    mock_delete_staged.assert_awaited_once_with(
        StagedUploadKey(upload_id=job.id, extension="wav")
    )


async def test_abandoned_transfer_is_closed_and_its_multipart_aborted(
    db_session: AsyncSession,
) -> None:
    transfer = {
        "multipart_id": "mp-1",
        "filename": "song.wav",
        "extension": "wav",
        "size_bytes": 8,
        "part_size_bytes": 8,
        "part_count": 1,
    }
    stale = Job(
        type=JobType.UPLOAD.value,
        status=JobStatus.PENDING.value,
        owner_did="did:test:walked-away",
        message="uploading your file...",
        phase="transfer",
        result={"transfer": transfer},
        updated_at=datetime.now(UTC) - timedelta(hours=25),
    )
    fresh = Job(
        type=JobType.UPLOAD.value,
        status=JobStatus.PENDING.value,
        owner_did="did:test:still-sending",
        message="uploading your file...",
        phase="transfer",
        result={"transfer": transfer},
        updated_at=datetime.now(UTC) - timedelta(hours=1),
    )
    db_session.add_all([stale, fresh])
    await db_session.commit()

    with patch(
        "backend._internal.tasks.reaper.storage.abort_staged_upload",
        new=AsyncMock(),
    ) as abort:
        await reap_abandoned_transfers()

    abort.assert_awaited_once_with(
        StagedUploadKey(upload_id=stale.id, extension="wav"), "mp-1"
    )
    await db_session.refresh(stale)
    await db_session.refresh(fresh)
    assert stale.status == JobStatus.FAILED.value
    assert "expired" in (stale.error or "")
    assert fresh.status == JobStatus.PENDING.value


async def test_sweep_keeps_bytes_a_live_upload_claims(
    db_session: AsyncSession,
) -> None:
    """a re-upload of the file that timed out hashes to the same key and
    writes its hints before its bytes. until its track row exists nothing
    else references the key, so the refcount guard alone would let the
    old job's sweep delete the new upload's audio."""
    await _seed_failed_job(db_session, completed_ago=timedelta(minutes=5))
    await _seed_upload_job(
        db_session,
        owner_did="did:plc:sweep",
        updated_at=datetime.now(UTC),
        file_id="abandoned1",
        file_type="wav",
    )

    with patch(
        "backend._internal.tasks.reaper.storage.discard_staged",
        new_callable=AsyncMock,
    ) as mock_discard:
        await sweep_abandoned_uploads()

    mock_discard.assert_not_awaited()


async def test_reaper_keeps_bytes_a_live_upload_claims(
    db_session: AsyncSession,
) -> None:
    """two submissions of one file: the stalled one is reaped while its twin
    is still processing. the twin's hints name the same key."""
    await _seed_artist(db_session, did="did:plc:twin", handle="twin.test")
    stalled = await _seed_upload_job(
        db_session,
        owner_did="did:plc:twin",
        updated_at=_stuck_in_past(_minutes_past_threshold()),
    )
    live = await _seed_upload_job(
        db_session, owner_did="did:plc:twin", updated_at=datetime.now(UTC)
    )

    with (
        patch(
            "backend._internal.tasks.reaper.storage.discard_staged",
            new_callable=AsyncMock,
        ) as mock_discard,
        patch(
            "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
            new_callable=AsyncMock,
        ),
    ):
        await reap_stuck_uploads()

    mock_discard.assert_not_awaited()
    await db_session.refresh(stalled)
    await db_session.refresh(live)
    assert stalled.status == JobStatus.FAILED.value
    assert live.status == JobStatus.PROCESSING.value
