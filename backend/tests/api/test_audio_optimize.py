"""tests for the decoupled publish/optimize audio pipeline.

a non-web-playable upload (AIFF) now publishes immediately referencing the raw
staged source as its interim playable rendition — `_store_audio` NEVER
transcodes, so a slow/wedged transcoder can't fail the upload — then a deferred
`optimize_track_audio` task produces the MP3 streaming rendition off the
critical path. these tests pin:

- the publish side: `_store_audio` does NOT transcode a lossless source; it
  flags optimization and reuses the raw source as both the interim playable
  file and the preserved `original_file_id`. `_upload_to_pds` skips the (large,
  throwaway) interim blob at publish.
- the optimize side: the task transcodes the original -> MP3, swaps the playable
  rendition, preserves the lossless original AND the record's createdAt, writes
  the single canonical PDS blob, deletes the orphaned interim (but NOT when the
  interim IS the original) — and is a safe no-op / leaves the track on its
  interim when it can't complete.

regression for the 2026-05-27 → 2026-05-30 incident where a 939MB AIFF blocked
on a synchronous transcode (first the MP3 encode, then the WAV remux) on the
upload critical path and produced no track at all.
"""

from __future__ import annotations

import contextlib
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend._internal.audio import AudioFormat
from backend.api.tracks.audio_optimize import optimize_track_audio
from backend.api.tracks.uploads import (
    AudioInfo,
    PdsBlobResult,
    StorageResult,
    TranscodeInfo,
    UploadContext,
    UploadPhaseError,
    _check_duplicate,
    _store_audio,
    _upload_to_pds,
)
from backend.config import settings
from backend.models import Artist, Track

OWNER_DID = "did:plc:optimizeowner"
TRACK_URI = f"at://{OWNER_DID}/fm.plyr.track/3koptimize001"


class _MockSession(Session):
    """drop-in auth session that doesn't touch encryption (mirrors the
    audio-replace suite's MockSession)."""

    def __init__(self, did: str = OWNER_DID) -> None:
        self.did = did
        self.handle = "owner.bsky.social"
        self.session_id = "session-id"
        self.access_token = "tok"
        self.refresh_token = "ref"
        self.oauth_session = {
            "did": did,
            "handle": "owner.bsky.social",
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": "atproto transition:generic",
            "access_token": "tok",
            "refresh_token": "ref",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture
async def owner(db_session: AsyncSession) -> Artist:
    artist = Artist(did=OWNER_DID, handle="owner.bsky.social", display_name="Owner")
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


def _wav_track(**overrides) -> Track:
    """a track published with the interim WAV rendition over an AIFF original.

    duration is a computed property backed by `extra`, so it's seeded there
    (mirrors the audio-replace suite's `make_track`).
    """
    defaults = {
        "title": "Long Mix",
        "artist_did": OWNER_DID,
        "file_id": "WAVID",
        "file_type": "wav",
        "original_file_id": "AIFFID",
        "original_file_type": "aiff",
        "atproto_record_uri": TRACK_URI,
        "atproto_record_cid": "bafyWAV",
        "r2_url": "https://audio.example/WAVID.wav",
        "audio_storage": "r2",
        "extra": {"duration": 5400},
    }
    defaults.update(overrides)
    return Track(**defaults)


def _transcode_info(transcoded_file_id: str, target: str) -> TranscodeInfo:
    return TranscodeInfo(
        original_file_id="AIFFID",
        original_file_type="aiff",
        transcoded_file_id=transcoded_file_id,
        transcoded_file_type=target,
    )


# --------------------------------------------------------------------------- #
# publish side
# --------------------------------------------------------------------------- #


async def test_store_audio_publishes_lossless_raw_and_flags_optimization() -> None:
    """a lossless source is NEVER transcoded on the publish path. it's published
    directly: the raw staged file is both the interim playable rendition and the
    preserved `original_file_id`, and the result is flagged for the deferred MP3
    optimization. this is the load-bearing invariant — track creation must not
    block on (or fail with) the transcoder."""
    ctx = UploadContext(
        upload_id="job-1",
        auth_session=_MockSession(),
        audio_file_id="AIFFID",
        filename="mix.aiff",
        duration=5400,
        title="Long Mix",
        artist_did=OWNER_DID,
        album=None,
        album_id=None,
        features_json=None,
        tags=[],
    )
    audio_info = AudioInfo(format=AudioFormat.AIFF, duration=5400, is_gated=False)

    with (
        patch(
            "backend.api.tracks.uploads._transcode_audio",
            new_callable=AsyncMock,
        ) as mock_transcode,
        patch(
            "backend.api.tracks.uploads.storage.get_url",
            new_callable=AsyncMock,
            return_value="https://audio.example/AIFFID.aiff",
        ),
    ):
        sr = await _store_audio(ctx, audio_info)

    # the publish path must NOT touch the transcoder at all
    mock_transcode.assert_not_awaited()
    # interim playable == the raw source == the preserved original
    assert sr.file_id == "AIFFID"
    assert sr.original_file_id == "AIFFID"
    assert sr.original_file_type == "aiff"
    assert sr.playable_format == AudioFormat.AIFF
    assert sr.needs_optimization is True


async def test_store_audio_web_playable_does_not_need_optimization() -> None:
    """an already web-playable upload (mp3) is served as-is, no transcode, no
    optimization."""
    ctx = UploadContext(
        upload_id="job-2",
        auth_session=_MockSession(),
        audio_file_id="MP3ID",
        filename="song.mp3",
        duration=180,
        title="Song",
        artist_did=OWNER_DID,
        album=None,
        album_id=None,
        features_json=None,
        tags=[],
    )
    audio_info = AudioInfo(format=AudioFormat.MP3, duration=180, is_gated=False)

    with (
        patch(
            "backend.api.tracks.uploads._transcode_audio",
            new_callable=AsyncMock,
        ) as mock_transcode,
        patch(
            "backend.api.tracks.uploads.storage.get_url",
            new_callable=AsyncMock,
            return_value="https://audio.example/MP3ID.mp3",
        ),
    ):
        sr = await _store_audio(ctx, audio_info)

    mock_transcode.assert_not_awaited()
    assert sr.needs_optimization is False
    assert sr.file_id == "MP3ID"
    assert sr.original_file_id is None


async def test_upload_to_pds_skips_when_optimization_pending() -> None:
    """the interim rendition must never be pushed to the user's PDS — the
    deferred optimize task writes the single canonical MP3 blob instead."""
    ctx = UploadContext(
        upload_id="job-3",
        auth_session=_MockSession(),
        audio_file_id="AIFFID",
        filename="mix.aiff",
        duration=5400,
        title="Long Mix",
        artist_did=OWNER_DID,
        album=None,
        album_id=None,
        features_json=None,
        tags=[],
    )
    audio_info = AudioInfo(format=AudioFormat.AIFF, duration=5400, is_gated=False)
    sr = StorageResult(
        file_id="AIFFID",
        original_file_id="AIFFID",
        original_file_type="aiff",
        playable_format=AudioFormat.AIFF,
        r2_url="https://audio.example/AIFFID.aiff",
        transcode_info=None,
        needs_optimization=True,
    )

    # patch the PDS upload boundary so a regression (not skipping) would call it
    with patch(
        "backend.api.tracks.uploads.upload_blob", new_callable=AsyncMock
    ) as mock_upload_blob:
        result = await _upload_to_pds(ctx, audio_info, sr)

    assert result is None
    mock_upload_blob.assert_not_awaited()


async def test_check_duplicate_matches_lossless_original(
    db_session: AsyncSession, owner: Artist
) -> None:
    """dedup survives the WAV->MP3 swap: a re-uploaded AIFF is caught by its
    stable source hash even though the existing track's playable file_id has
    since changed to the MP3."""
    track = _wav_track(file_id="MP3ID", file_type="mp3", original_file_id="AIFFID")
    db_session.add(track)
    await db_session.commit()

    ctx = UploadContext(
        upload_id="job-4",
        auth_session=_MockSession(),
        audio_file_id="AIFFID",  # same lossless source re-uploaded
        filename="mix.aiff",
        duration=5400,
        title="Long Mix",
        artist_did=OWNER_DID,
        album=None,
        album_id=None,
        features_json=None,
        tags=[],
    )
    sr = StorageResult(
        file_id="DIFFERENT_WAV",
        original_file_id="AIFFID",
        original_file_type="aiff",
        playable_format=AudioFormat.WAV,
        r2_url="https://audio.example/DIFFERENT_WAV.wav",
        transcode_info=None,
        needs_optimization=True,
    )

    with pytest.raises(UploadPhaseError, match="duplicate"):
        await _check_duplicate(ctx, sr)


# --------------------------------------------------------------------------- #
# optimize side
# --------------------------------------------------------------------------- #


@contextlib.contextmanager
def _patch_optimize(
    *,
    transcode: TranscodeInfo | None,
    pds: PdsBlobResult | None,
    update_record_side_effect: object = None,
    session: Session | None = None,
    deleted: list[str] | None = None,
):
    """patch every external boundary of `optimize_track_audio`, leaving the real
    DB reads/writes (_load_audio_state, _refresh_metadata, _commit_optimize_swap)
    and the real record builder running against the seeded track.

    yields a dict of the started mocks so tests can assert on them.
    """
    update_record_kwargs: dict = (
        {"side_effect": update_record_side_effect}
        if update_record_side_effect is not None
        else {"return_value": (TRACK_URI, "bafyNEWREC")}
    )

    async def fake_delete(file_id: str, file_type: str | None = None) -> bool:
        if deleted is not None:
            deleted.append(file_id)
        return True

    job_service_mock = AsyncMock()
    job_service_mock.create_job = AsyncMock(return_value="opt-job")

    with (
        patch(
            "backend.api.tracks.audio_optimize.get_session",
            new_callable=AsyncMock,
            return_value=_MockSession() if session is None else session,
        ),
        patch(
            "backend.api.tracks.audio_optimize._transcode_audio",
            new_callable=AsyncMock,
            return_value=transcode,
        ) as mock_transcode,
        patch(
            "backend.api.tracks.audio_optimize.storage.get_url",
            new_callable=AsyncMock,
            return_value="https://audio.example/MP3NEW.mp3",
        ),
        patch(
            "backend.api.tracks.audio_optimize._upload_to_pds",
            new_callable=AsyncMock,
            return_value=pds,
        ) as mock_upload_to_pds,
        patch(
            "backend.api.tracks.audio_optimize.build_track_record",
            new_callable=AsyncMock,
            return_value={"$type": "fm.plyr.track", "title": "Long Mix"},
        ) as mock_build_record,
        patch(
            "backend.api.tracks.audio_optimize.update_record",
            AsyncMock(**update_record_kwargs),
        ) as mock_update_record,
        patch(
            "backend.api.tracks.audio_optimize.storage.delete",
            new_callable=AsyncMock,
            side_effect=fake_delete,
        ),
        patch(
            "backend.api.tracks.audio_optimize.invalidate_tracks_discovery_cache",
            new_callable=AsyncMock,
        ),
        patch("backend.api.tracks.audio_optimize.job_service", job_service_mock),
    ):
        yield {
            "transcode": mock_transcode,
            "upload_to_pds": mock_upload_to_pds,
            "build_record": mock_build_record,
            "update_record": mock_update_record,
        }


async def test_optimize_swaps_wav_to_mp3_preserving_original_and_created_at(
    db_session: AsyncSession, owner: Artist
) -> None:
    """happy path: WAV->MP3 swap, lossless original preserved, single PDS blob
    written, record createdAt preserved, interim WAV deleted."""
    track = _wav_track()
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    track_id = track.id
    original_created_at = track.created_at

    deleted: list[str] = []
    pds = PdsBlobResult(
        blob_ref={"$type": "blob", "ref": {"$link": "bafyMP3BLOB"}, "size": 216},
        cid="bafyMP3BLOB",
        size=216,
    )
    with _patch_optimize(
        transcode=_transcode_info("MP3NEW", "mp3"), pds=pds, deleted=deleted
    ) as mocks:
        await optimize_track_audio(track_id, "session-id")

    # transcoded the lossless ORIGINAL to mp3 with the generous deferred timeout
    call = mocks["transcode"].await_args
    assert call.args[1] == "AIFFID"  # source = lossless original
    assert call.args[3] == "aiff"  # source format
    assert call.kwargs["target_format"] == "mp3"
    assert (
        call.kwargs["timeout_seconds"] == settings.transcoder.optimize_timeout_seconds
    )

    # DB row swapped to the mp3 rendition; lossless original preserved
    await db_session.refresh(track)
    assert track.file_id == "MP3NEW"
    assert track.file_type == "mp3"
    assert track.r2_url == "https://audio.example/MP3NEW.mp3"
    assert track.original_file_id == "AIFFID"
    assert track.original_file_type == "aiff"
    assert track.pds_blob_cid == "bafyMP3BLOB"
    assert track.audio_storage == "both"
    assert track.atproto_record_cid == "bafyNEWREC"

    # the rebuilt record is built with the track's ORIGINAL createdAt, not a
    # fresh one — so the optimization doesn't bump the track to "now".
    assert mocks["build_record"].await_args.kwargs["created_at"] == original_created_at

    # the interim WAV is now orphaned and was deleted
    assert "WAVID" in deleted


async def test_optimize_is_noop_when_already_mp3(
    db_session: AsyncSession, owner: Artist
) -> None:
    """idempotency: a track already on the mp3 rendition is skipped (so docket
    retries don't re-encode or clobber)."""
    track = _wav_track(file_id="MP3DONE", file_type="mp3")
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    track_id = track.id

    with _patch_optimize(transcode=_transcode_info("X", "mp3"), pds=None) as mocks:
        await optimize_track_audio(track_id, "session-id")

    mocks["transcode"].assert_not_awaited()
    await db_session.refresh(track)
    assert track.file_id == "MP3DONE"  # untouched


async def test_optimize_transient_failure_raises_for_retry_and_drops_orphan_mp3(
    db_session: AsyncSession, owner: Artist
) -> None:
    """transient failure before PDS publishes: the track stays on its WAV
    rendition (consistent), the orphaned MP3 is cleaned up, and the exception
    propagates so docket's `ExponentialRetry` can try again."""
    track = _wav_track()
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    track_id = track.id

    deleted: list[str] = []
    with (
        _patch_optimize(
            transcode=_transcode_info("MP3NEW", "mp3"),
            pds=None,
            update_record_side_effect=RuntimeError("PDS putRecord exploded"),
            deleted=deleted,
        ),
        pytest.raises(RuntimeError, match="PDS putRecord exploded"),
    ):
        await optimize_track_audio(track_id, "session-id")

    # track unchanged — still on the WAV rendition
    await db_session.refresh(track)
    assert track.file_id == "WAVID"
    assert track.file_type == "wav"

    # the orphaned MP3 was deleted (PDS hadn't been told about it); the live
    # WAV was NOT
    assert "MP3NEW" in deleted
    assert "WAVID" not in deleted


async def test_optimize_transient_transcode_failure_raises_for_retry(
    db_session: AsyncSession, owner: Artist
) -> None:
    """`_transcode_audio` returns None for the transient family (transcoder
    timeout / 5xx / I/O error). That path must raise so docket's
    `ExponentialRetry` actually fires — treating it as a terminal abort would
    leave the track on WAV forever despite the explicit retry plumbing."""
    track = _wav_track()
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    track_id = track.id

    with (
        _patch_optimize(transcode=None, pds=None),
        pytest.raises(RuntimeError, match="transcode to mp3 failed"),
    ):
        await optimize_track_audio(track_id, "session-id")

    await db_session.refresh(track)
    assert track.file_id == "WAVID"  # untouched; retry will try again
    assert track.file_type == "wav"


async def test_optimize_aborts_when_track_replaced_during_encode(
    db_session: AsyncSession, owner: Artist
) -> None:
    """race with `audio_replace`: if the track audio changes between when the
    optimization captures state and when it goes to publish, the pre-publish
    guard aborts terminally — the user's replacement is NOT clobbered."""
    track = _wav_track()
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    track_id = track.id

    # simulate a concurrent audio_replace that lands between the optimize's
    # _upload_to_pds and the pre-publish guard: side-effect on the PDS-upload
    # boundary mutates the track row to a different rendition + lossless source.
    from backend.utilities.database import db_session as app_db_session

    async def replace_during_encode(*_a, **_kw):
        async with app_db_session() as db:
            row = await db.get(Track, track_id)
            if row is not None:
                row.file_id = "REPLACED_WAV"
                row.original_file_id = "REPLACED_AIFF"
                await db.commit()
        return None  # _upload_to_pds returns None (no PDS blob)

    deleted: list[str] = []
    # _patch_optimize sets a default _upload_to_pds patch; we re-patch over it
    # AFTER entering so our mutation side_effect wins.
    with (
        _patch_optimize(
            transcode=_transcode_info("MP3NEW", "mp3"),
            pds=None,
            deleted=deleted,
        ),
        patch(
            "backend.api.tracks.audio_optimize._upload_to_pds",
            new_callable=AsyncMock,
            side_effect=replace_during_encode,
        ),
    ):
        await optimize_track_audio(track_id, "session-id")

    # the user's replacement survives — optimize did NOT clobber it
    await db_session.refresh(track)
    assert track.file_id == "REPLACED_WAV"
    assert track.original_file_id == "REPLACED_AIFF"

    # the orphaned MP3 was cleaned up; we never published it to PDS
    assert "MP3NEW" in deleted


async def test_optimize_preserves_mp3_when_pds_published_then_cas_misses(
    db_session: AsyncSession, owner: Artist
) -> None:
    """if a concurrent replace lands AFTER our PDS write but BEFORE our DB CAS,
    the CAS misses and we abort — but we must NOT delete the MP3, because PDS
    now references it and third-party readers may already be fetching the url.

    better to leak storage than to 404 their playback. the racing replace will
    overwrite our PDS record with its own audio shortly after.
    """
    track = _wav_track()
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    track_id = track.id

    # side-effect on update_record (which runs AFTER the pre-publish guard) —
    # mutates the track AFTER PDS has been written, so the CAS in
    # _commit_optimize_swap sees mismatched file_id and rowcount==0.
    from backend.utilities.database import db_session as app_db_session

    async def replace_after_pds_write(**_kwargs):
        async with app_db_session() as db:
            row = await db.get(Track, track_id)
            if row is not None:
                row.file_id = "REPLACED_AFTER_PDS"
                row.original_file_id = "REPLACED_AIFF"
                await db.commit()
        return (TRACK_URI, "bafyNEWREC")

    deleted: list[str] = []
    with _patch_optimize(
        transcode=_transcode_info("MP3NEW", "mp3"),
        pds=PdsBlobResult(
            blob_ref={"$type": "blob", "ref": {"$link": "bafyMP3"}, "size": 216},
            cid="bafyMP3",
            size=216,
        ),
        update_record_side_effect=replace_after_pds_write,
        deleted=deleted,
    ):
        await optimize_track_audio(track_id, "session-id")

    # the racing replace survived; our CAS correctly refused to overwrite it
    await db_session.refresh(track)
    assert track.file_id == "REPLACED_AFTER_PDS"

    # CRUCIAL: the MP3 was NOT deleted — PDS references it
    assert "MP3NEW" not in deleted


async def test_optimize_skips_when_session_gone(
    db_session: AsyncSession, owner: Artist
) -> None:
    """no session (expired) -> can't write to PDS; leave the track on WAV and
    don't even start a transcode."""
    track = _wav_track()
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    track_id = track.id

    with (
        patch(
            "backend.api.tracks.audio_optimize.get_session",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "backend.api.tracks.audio_optimize._transcode_audio",
            new_callable=AsyncMock,
        ) as mock_transcode,
    ):
        await optimize_track_audio(track_id, "session-id")

    mock_transcode.assert_not_awaited()
    await db_session.refresh(track)
    assert track.file_id == "WAVID"


def _raw_interim_track(**overrides) -> Track:
    """a track published under the decoupled scheme: the raw lossless source IS
    the interim playable rendition, so `file_id == original_file_id` (one shared
    storage object). this is what `_store_audio` now produces for AIFF."""
    defaults = {
        "title": "Long Mix",
        "artist_did": OWNER_DID,
        "file_id": "AIFFID",
        "file_type": "aiff",
        "original_file_id": "AIFFID",
        "original_file_type": "aiff",
        "atproto_record_uri": TRACK_URI,
        "atproto_record_cid": "bafyAIFF",
        "r2_url": "https://audio.example/AIFFID.aiff",
        "audio_storage": "r2",
        "extra": {"duration": 5400},
    }
    defaults.update(overrides)
    return Track(**defaults)


async def test_optimize_raw_interim_does_not_delete_the_lossless_original(
    db_session: AsyncSession, owner: Artist
) -> None:
    """the load-bearing post-decoupling invariant: when the interim playable
    rendition IS the raw lossless source (`file_id == original_file_id`), the
    swap to MP3 must NOT delete that object — it's still referenced as the
    archival `original_file_id`. deleting it would strip the master AND break
    any client still streaming the interim.

    (contrast `test_optimize_swaps_wav_to_mp3_...`, where a distinct legacy WAV
    interim IS correctly deleted.)"""
    track = _raw_interim_track()
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    track_id = track.id

    deleted: list[str] = []
    pds = PdsBlobResult(
        blob_ref={"$type": "blob", "ref": {"$link": "bafyMP3BLOB"}, "size": 216},
        cid="bafyMP3BLOB",
        size=216,
    )
    with _patch_optimize(
        transcode=_transcode_info("MP3NEW", "mp3"), pds=pds, deleted=deleted
    ) as mocks:
        await optimize_track_audio(track_id, "session-id")

    # transcoded the lossless ORIGINAL (the shared raw object) to mp3
    assert mocks["transcode"].await_args.args[1] == "AIFFID"

    # swapped to the mp3 rendition; the lossless original is preserved
    await db_session.refresh(track)
    assert track.file_id == "MP3NEW"
    assert track.file_type == "mp3"
    assert track.original_file_id == "AIFFID"
    assert track.original_file_type == "aiff"

    # CRUCIAL: the raw source/original was NOT deleted as a stale interim
    assert "AIFFID" not in deleted
