"""Keep protected originals on the PDS through deferred optimization."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import BinaryIO
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.atproto.spaces.client import SpaceAccessError
from backend._internal.atproto.spaces.uris import build_record_uri, build_space_uri
from backend.api.tracks import audio_optimize as optimize
from backend.api.tracks.uploads import StorageResult, TranscodeInfo
from backend.config import settings
from backend.models import Artist, Track
from backend.utilities.audio_formats import AudioFormat
from tests.api.test_audio_optimize import OWNER_DID, TRACK_URI, _MockSession


@pytest.fixture
async def protected_track(db_session: AsyncSession) -> Track:
    db_session.add(
        Artist(did=OWNER_DID, handle="protected.test", display_name="Protected")
    )
    await db_session.flush()
    track = Track(
        title="protected original",
        artist_did=OWNER_DID,
        file_id="MASTER",
        file_type="aiff",
        original_file_id="MASTER",
        original_file_type="aiff",
        audio_storage="r2_private",
        atproto_record_uri=TRACK_URI,
        download_policy="supporters",
        protected_audio={
            "record_uri": build_record_uri(
                build_space_uri(
                    OWNER_DID, settings.atproto.private_media_space_type, "playback"
                ),
                OWNER_DID,
                settings.atproto.track_collection,
                "original",
            ),
            "record_cid": "bafyold",
            "audio_blob": {"ref": {"$link": "bafymaster"}},
            "mirror_verified": True,
        },
    )
    db_session.add(track)
    await db_session.commit()
    return track


@pytest.mark.parametrize("fail_at", [None, "transcode", "public_record"])
async def test_optimize_keeps_original_and_never_publicly_references_blob(
    db_session: AsyncSession,
    protected_track: Track,
    monkeypatch: pytest.MonkeyPatch,
    fail_at: str | None,
) -> None:
    old = protected_track.protected_audio
    assert old is not None
    source = {
        "record_uri": "at://protected/optimized",
        "record_cid": "bafynew",
        "audio_blob": {"ref": {"$link": "bafymp3"}},
        "original_blob": old["audio_blob"],
    }
    monkeypatch.setattr(optimize, "get_session", AsyncMock(return_value=_MockSession()))
    monkeypatch.setattr(optimize, "get_space_credential", AsyncMock())
    jobs = AsyncMock()
    jobs.create_job.return_value = "optimize-test"
    monkeypatch.setattr(optimize, "job_service", jobs)
    monkeypatch.setattr(optimize, "notify_new_track", AsyncMock())
    monkeypatch.setattr(optimize, "invalidate_tracks_discovery_cache", AsyncMock())
    monkeypatch.setattr(optimize.storage, "head_file", AsyncMock(return_value=9))
    transcode = AsyncMock(
        return_value=None
        if fail_at == "transcode"
        else TranscodeInfo("MASTER", "aiff", "MP3", "mp3")
    )
    monkeypatch.setattr(optimize, "_transcode_audio", transcode)
    public_upload = AsyncMock(
        side_effect=AssertionError("protected source must not become a public blob")
    )
    monkeypatch.setattr(optimize, "_upload_to_pds", public_upload)
    monkeypatch.setattr(
        optimize, "upload_stored_audio", AsyncMock(return_value=source["audio_blob"])
    )
    publish_source = AsyncMock(return_value=source)
    monkeypatch.setattr(optimize, "publish_protected_blob", publish_source)
    publish_record = AsyncMock(return_value=(TRACK_URI, "bafypublic"))
    if fail_at == "public_record":
        publish_record.side_effect = httpx.ReadTimeout("ambiguous publication")
    monkeypatch.setattr(optimize, "update_record", publish_record)
    discard_source = AsyncMock()
    monkeypatch.setattr(optimize, "delete_protected_audio", discard_source)
    delete_mirror = AsyncMock()
    monkeypatch.setattr(optimize.storage, "delete_gated", delete_mirror)
    if fail_at:
        with pytest.raises((RuntimeError, httpx.ReadTimeout)):
            await optimize.optimize_track_audio(protected_track.id, "session-id")
    else:
        await optimize.optimize_track_audio(protected_track.id, "session-id")
    await db_session.refresh(protected_track)
    public_upload.assert_not_awaited()
    assert protected_track.pds_blob_cid is None
    assert protected_track.original_file_id == "MASTER"
    assert protected_track.download_policy == "supporters"
    if fail_at:
        assert protected_track.file_id == "MASTER"
        assert protected_track.protected_audio == old
        discard_source.assert_not_awaited()
    else:
        assert protected_track.file_id == "MP3"
        assert protected_track.protected_audio == {**source, "mirror_verified": True}
        assert publish_source.await_args is not None
        assert publish_source.await_args.kwargs["original_blob"] == old["audio_blob"]
        assert publish_source.await_args.kwargs["original_file_id"] == "MASTER"
        assert publish_record.await_args is not None
        record = publish_record.await_args.kwargs["record"]
        assert record["audioSpace"] == source["record_uri"]
        assert "audioBlob" not in record
        assert record["downloadPolicy"] == "supporters"
        assert discard_source.await_count == 1
        assert discard_source.await_args is not None
        assert discard_source.await_args.args[1] == old
        delete_mirror.assert_not_awaited()


async def test_optimizer_cas_does_not_overwrite_changed_protected_pointer(
    db_session: AsyncSession,
    protected_track: Track,
) -> None:
    state = await optimize._load_audio_state(protected_track.id)
    assert state is not None
    protected_track.protected_audio = {
        **(protected_track.protected_audio or {}),
        "record_uri": "at://changed",
    }
    await db_session.commit()
    sr = StorageResult(
        file_id="MP3",
        original_file_id="MASTER",
        original_file_type="aiff",
        playable_format=AudioFormat.MP3,
        r2_url=None,
        transcode_info=None,
    )
    assert not await optimize._commit_optimize_swap(
        state, sr, None, "bafynew", {"record_uri": "at://new"}
    )
    await db_session.refresh(protected_track)
    assert protected_track.file_id == "MASTER"
    with pytest.raises(optimize._OptimizeAbort):
        await optimize._verify_still_optimizable(state)


async def test_unverified_hash_claim_fetches_pds_even_when_private_object_exists(
    db_session: AsyncSession,
    protected_track: Track,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    protected_track.protected_audio = {
        **(protected_track.protected_audio or {}),
        "mirror_verified": False,
    }
    await db_session.commit()
    state = await optimize._load_audio_state(protected_track.id)
    assert state is not None
    monkeypatch.setattr(optimize.storage, "head_file", AsyncMock(return_value=999))
    monkeypatch.setattr(optimize, "get_space_credential", AsyncMock())
    seen: list[bytes] = []

    @asynccontextmanager
    async def remote(*args: object, **kwargs: object) -> AsyncIterator[httpx.Response]:
        yield httpx.Response(
            200,
            content=b"source-from-pds",
            request=httpx.Request("GET", "https://pds.test/blob"),
        )

    async def save(file: BinaryIO, filename: str) -> str:
        seen.append(file.read())
        return "different-actual-hash"

    monkeypatch.setattr(optimize, "open_protected_blob", remote)
    monkeypatch.setattr(optimize.storage, "save_gated", save)
    with pytest.raises(ValueError, match="content hash"):
        await optimize._restore_protected_source(state)
    assert seen == [b"source-from-pds"]


async def test_optimizer_accepts_own_publication_echo_without_losing_verified_mirror(
    db_session: AsyncSession,
    protected_track: Track,
) -> None:
    state = await optimize._load_audio_state(protected_track.id)
    assert state is not None
    published = {
        "record_uri": "at://protected/new",
        "record_cid": "bafysource",
        "audio_blob": {"ref": {"$link": "bafymp3"}},
        "mirror_verified": True,
    }
    protected_track.file_id = "MP3"
    protected_track.file_type = "mp3"
    protected_track.atproto_record_cid = "bafypublic"
    protected_track.protected_audio = {**published, "mirror_verified": False}
    await db_session.commit()
    sr = StorageResult(
        file_id="MP3",
        original_file_id="MASTER",
        original_file_type="aiff",
        playable_format=AudioFormat.MP3,
        r2_url=None,
        transcode_info=None,
    )
    assert await optimize._commit_optimize_swap(
        state, sr, None, "bafypublic", published
    )
    await db_session.refresh(protected_track)
    assert protected_track.protected_audio == published


async def test_verified_optimizer_mirror_requires_current_app_authorization(
    db_session: AsyncSession,
    protected_track: Track,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = await optimize._load_audio_state(protected_track.id)
    assert state is not None and state.protected_audio is not None
    assert state.protected_audio["mirror_verified"] is True
    denied = AsyncMock(side_effect=SpaceAccessError("app access refused on renewal"))
    monkeypatch.setattr(optimize, "get_space_credential", denied)
    private_copy = AsyncMock(return_value=123)
    monkeypatch.setattr(optimize.storage, "head_file", private_copy)
    with pytest.raises(SpaceAccessError, match="app access refused"):
        await optimize._restore_protected_source(state)
    denied.assert_awaited_once()
    private_copy.assert_not_awaited()
