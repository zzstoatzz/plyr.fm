"""publication and abandonment of an upload job compete on the job row.

the stuck-upload reaper abandons a job (status failed, committed) and then
deletes its bytes. before this fence a worker that was merely paused past
the reaper threshold woke up, reserved the track row, wrote the PDS record
and marked the job completed — a published track pointing at deleted audio.

each test drives the real orchestrator against the real job service and
database; only storage, the PDS and the sibling phases are stubbed. the
schedules mirror T3, T4 and T5 of the "two writes, one promise" brief.
"""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import ExitStack, contextmanager
from datetime import UTC, datetime, timedelta
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend._internal.jobs import job_service
from backend._internal.tasks import reaper
from backend.api.tracks.audio_replace import TrackAudioState, _commit_db_swap
from backend.api.tracks.uploads import (
    AudioInfo,
    StorageResult,
    UploadContext,
    UploadPhaseError,
    _process_upload_background,
    _settle_staged_audio,
    stage_audio_to_storage,
)
from backend.models import Artist, Track, TrackRevision
from backend.models.job import Job, JobStatus, JobType
from backend.storage.r2 import R2Storage
from backend.utilities.audio_formats import AudioFormat

ARTIST_DID = "did:plc:fence"
FILE_ID = "fencedbytes00001"


class _MockSession(Session):
    def __init__(self) -> None:
        self.did = ARTIST_DID
        self.handle = "fence.test"
        self.session_id = "session-fence"
        self.oauth_session = {"did": ARTIST_DID, "access_token": "tok"}


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    row = Artist(did=ARTIST_DID, handle="fence.test", display_name="Fence")
    db_session.add(row)
    await db_session.commit()
    return row


async def _seed_job(
    db: AsyncSession, *, status: JobStatus = JobStatus.PROCESSING
) -> Job:
    job = Job(
        type=JobType.UPLOAD.value,
        status=status.value,
        owner_did=ARTIST_DID,
        message="processing upload...",
        file_id=FILE_ID,
        file_type="mp3",
        is_gated=False,
        completed_at=datetime.now(UTC) if status is JobStatus.FAILED else None,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


def _ctx(upload_id: str) -> UploadContext:
    return UploadContext(
        upload_id=upload_id,
        auth_session=_MockSession(),
        audio_file_id=FILE_ID,
        filename="fence.mp3",
        duration=120,
        title="fence",
        artist_did=ARTIST_DID,
        album=None,
        album_id=None,
        features_json=None,
        tags=[],
    )


def _sr() -> StorageResult:
    return StorageResult(
        file_id=FILE_ID,
        original_file_id=None,
        original_file_type=None,
        playable_format=AudioFormat.MP3,
        r2_url=f"https://audio.example/{FILE_ID}.mp3",
        transcode_info=None,
    )


async def _reap_now(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(reaper, "STUCK_UPLOAD_THRESHOLD", timedelta(0))
    await reaper.reap_stuck_uploads()


@contextmanager
def _pipeline(
    *,
    upload_to_pds: Callable[..., Awaitable[None]] | None = None,
    find_duplicate: Callable[..., Awaitable[None]] | None = None,
    post_upload: Callable[..., Awaitable[None]] | None = None,
    real_discard: bool = False,
) -> Iterator[SimpleNamespace]:
    """stub everything outside the orchestrator + job service + database.

    the worker and the reaper share one storage proxy, so `discard` sees
    both of their `discard_staged` calls. `real_discard` leaves it real so
    the refcount guard runs against the test database; the R2 deletes
    behind it are stubbed on the class instead.
    """
    mocks = SimpleNamespace(
        create_record=AsyncMock(return_value=("at://ignored", "bafycid")),
        discard=AsyncMock(return_value=True),
        r2_delete=AsyncMock(return_value=True),
        r2_delete_gated=AsyncMock(return_value=True),
        notify=AsyncMock(),
    )
    with ExitStack() as stack:
        for target, value in (
            (
                "backend.api.tracks.uploads._validate_audio",
                AsyncMock(
                    return_value=AudioInfo(
                        format=AudioFormat.MP3, duration=120, is_gated=False
                    )
                ),
            ),
            ("backend.api.tracks.uploads._store_audio", AsyncMock(return_value=_sr())),
            (
                "backend.api.tracks.uploads._upload_to_pds",
                upload_to_pds or AsyncMock(return_value=None),
            ),
            (
                "backend.api.tracks.uploads._store_image",
                AsyncMock(return_value=(None, None, None)),
            ),
            ("backend.api.tracks.uploads.create_track_record", mocks.create_record),
            (
                "backend.api.tracks.uploads._schedule_post_upload",
                post_upload or AsyncMock(),
            ),
            (
                "backend._internal.tasks.reaper.notification_service.send_reaper_notification",
                mocks.notify,
            ),
        ):
            stack.enter_context(patch(target, value))
        if real_discard:
            stack.enter_context(patch.object(R2Storage, "delete", mocks.r2_delete))
            stack.enter_context(
                patch.object(R2Storage, "delete_gated", mocks.r2_delete_gated)
            )
        else:
            stack.enter_context(
                patch(
                    "backend.api.tracks.uploads.storage.discard_staged", mocks.discard
                )
            )
        if find_duplicate is not None:
            stack.enter_context(
                patch("backend.api.tracks.uploads._find_duplicate", find_duplicate)
            )
        yield mocks


async def _tracks(db: AsyncSession) -> list[Track]:
    return list(
        (await db.execute(select(Track).where(Track.artist_did == ARTIST_DID)))
        .scalars()
        .all()
    )


async def test_worker_that_wakes_after_the_reaper_cannot_publish(
    db_session: AsyncSession, artist: Artist, monkeypatch: pytest.MonkeyPatch
) -> None:
    """T3/T4: the reaper abandons the job and deletes its bytes while the
    worker is paused inside the PDS phase. the worker resumes, and the
    reservation must refuse — no track row, no PDS record."""
    job = await _seed_job(db_session)

    async def paused_then_reaped(*_: object, **__: object) -> None:
        await _reap_now(monkeypatch)

    with _pipeline(upload_to_pds=paused_then_reaped) as mocks:
        await _process_upload_background(_ctx(job.id))

    assert await _tracks(db_session) == []
    mocks.create_record.assert_not_awaited()
    assert mocks.discard.await_args_list == [
        ((FILE_ID, "mp3"), {"gated": False}),
        ((FILE_ID, "mp3"), {}),
    ]

    await db_session.refresh(job)
    assert job.status == JobStatus.FAILED.value
    assert job.error is not None and "timed out" in job.error


async def test_publication_holds_the_job_row_so_the_reaper_skips_it(
    db_session: AsyncSession, artist: Artist, monkeypatch: pytest.MonkeyPatch
) -> None:
    """T5: the reservation transaction holds the job row when the reaper
    runs. `FOR UPDATE SKIP LOCKED` passes over it, publication commits,
    and nothing is deleted."""
    job = await _seed_job(db_session)
    lookups = 0

    async def reaper_runs_during_reservation(*_: object) -> None:
        """`_find_duplicate` runs twice: phase 3's early check, then inside
        the reservation transaction after the fence. reap on the second."""
        nonlocal lookups
        lookups += 1
        if lookups == 2:
            await _reap_now(monkeypatch)

    with _pipeline(find_duplicate=reaper_runs_during_reservation) as mocks:
        await _process_upload_background(_ctx(job.id))

    assert lookups == 2
    assert len(await _tracks(db_session)) == 1
    mocks.create_record.assert_awaited_once()
    mocks.discard.assert_not_awaited()
    mocks.notify.assert_not_awaited()

    await db_session.refresh(job)
    assert job.status == JobStatus.COMPLETED.value


async def test_reaping_a_published_job_keeps_the_bytes_and_stays_failed(
    db_session: AsyncSession, artist: Artist, monkeypatch: pytest.MonkeyPatch
) -> None:
    """the worker stalls after the track row committed. the reaper may fail
    the job, but the refcount guard keeps the audio, and the worker's late
    'completed' write must not revive the abandoned job."""
    job = await _seed_job(db_session)

    async def stalled_in_hooks(*_: object, **__: object) -> None:
        await _reap_now(monkeypatch)

    with _pipeline(post_upload=stalled_in_hooks, real_discard=True) as mocks:
        await _process_upload_background(_ctx(job.id))

    assert len(await _tracks(db_session)) == 1
    mocks.r2_delete.assert_not_awaited()
    mocks.r2_delete_gated.assert_not_awaited()

    await db_session.refresh(job)
    assert job.status == JobStatus.FAILED.value
    assert job.error is not None and "timed out" in job.error


async def test_finished_jobs_ignore_progress_and_heartbeats(
    db_session: AsyncSession,
) -> None:
    """S2: completed and failed are terminal."""
    failed = await _seed_job(db_session, status=JobStatus.FAILED)
    stale = datetime.now(UTC) - timedelta(hours=1)
    failed.updated_at = stale
    failed.error = "upload timed out"
    await db_session.commit()

    assert (
        await job_service.update_progress(
            failed.id, JobStatus.COMPLETED, "upload completed successfully"
        )
        is False
    )
    await job_service.heartbeat(failed.id)

    await db_session.refresh(failed)
    assert failed.status == JobStatus.FAILED.value
    assert failed.error == "upload timed out"
    assert failed.updated_at == stale

    live = await _seed_job(db_session)
    assert await job_service.update_progress(live.id, JobStatus.PROCESSING, "…")


async def test_settle_writes_cleanup_hints_before_promoting_the_bytes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """a crash between the copy and the hint would leave an object no sweep
    can find; the hint must exist before the object does."""
    order: list[str] = []
    payload = b"resumable bytes"
    expected = hashlib.sha256(payload).hexdigest()[:16]

    async def stream(_key: object) -> AsyncIterator[bytes]:
        yield payload

    async def set_hints(_id: str, **kwargs: object) -> None:
        order.append(f"hints:{kwargs['file_id']}")

    async def promote(*_: object, **__: object) -> None:
        order.append("promote")

    monkeypatch.setattr("backend.api.tracks.uploads.storage.stream_staged", stream)
    monkeypatch.setattr("backend.api.tracks.uploads.storage.promote_staged", promote)
    monkeypatch.setattr(
        "backend.api.tracks.uploads.job_service",
        SimpleNamespace(
            update_progress=AsyncMock(),
            heartbeat=AsyncMock(),
            set_cleanup_hints=set_hints,
        ),
    )
    monkeypatch.setattr("backend.api.tracks.uploads.extract_duration", lambda _f: 120)

    ctx = _ctx("upload-settle")
    ctx.staged = True
    await _settle_staged_audio(ctx)

    assert order == [f"hints:{expected}", "promote"]
    assert ctx.audio_file_id == expected


async def test_single_request_staging_writes_cleanup_hints_before_saving(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    order: list[str] = []
    payload = b"single request bytes"
    expected = hashlib.sha256(payload).hexdigest()[:16]

    async def set_hints(_id: str, **kwargs: object) -> None:
        order.append(f"hints:{kwargs['file_id']}:{kwargs['file_type']}")

    async def save(file: BytesIO, *_: object, **__: object) -> str:
        order.append("save")
        assert file.tell() == 0
        return expected

    monkeypatch.setattr("backend.api.tracks.uploads.storage.save", save)
    monkeypatch.setattr(
        "backend.api.tracks.uploads.job_service",
        SimpleNamespace(update_progress=AsyncMock(), set_cleanup_hints=set_hints),
    )

    file_id = await stage_audio_to_storage("upload-single", BytesIO(payload), "a.MP3")

    assert file_id == expected
    assert order == [f"hints:{expected}:mp3", "save"]


async def test_audio_replace_swap_refuses_an_abandoned_job(
    db_session: AsyncSession, artist: Artist
) -> None:
    """the replace worker's DB swap is its publication step; a reaped
    replace job must leave the track on its old audio."""
    track = Track(
        title="keep me",
        file_id="oldaudio00000001",
        file_type="mp3",
        artist_did=ARTIST_DID,
        r2_url="https://audio.example/oldaudio00000001.mp3",
        atproto_record_uri=f"at://{ARTIST_DID}/fm.plyr.dev.track/abc",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    job = await _seed_job(db_session, status=JobStatus.FAILED)

    state = TrackAudioState(
        track_id=track.id,
        artist_did=ARTIST_DID,
        artist_display_name="Fence",
        atproto_record_uri=track.atproto_record_uri or "",
        old_file_id=track.file_id,
        old_file_type=track.file_type,
        old_original_file_id=None,
        old_original_file_type=None,
        title=track.title,
        album=None,
        duration=None,
        features=[],
        image_url=None,
        description=None,
        self_labels=[],
        support_gate=None,
        created_at=datetime.now(UTC),
    )
    with pytest.raises(UploadPhaseError, match="abandoned"):
        await _commit_db_swap(
            job.id,
            state,
            AudioInfo(format=AudioFormat.MP3, duration=100, is_gated=False),
            _sr(),
            None,
            "bafynewcid",
        )

    await db_session.refresh(track)
    assert track.file_id == "oldaudio00000001"
    revisions = (await db_session.execute(select(TrackRevision))).scalars().all()
    assert revisions == []
