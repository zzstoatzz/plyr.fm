"""Project protected PDS sources without trusting public proxy URLs."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.atproto.spaces.client import SpaceAccessError
from backend._internal.atproto.spaces.uris import build_record_uri, build_space_uri
from backend._internal.tasks import ingest
from backend.config import settings
from backend.models import Artist, Track


@pytest.fixture
async def protected_artist(db_session: AsyncSession) -> Artist:
    artist = Artist(
        did=f"did:plc:protected{uuid4().hex[:12]}",
        handle="protected.test",
        display_name="Protected",
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


def source(artist: Artist, rkey: str = "first") -> tuple[dict, dict]:
    uri = build_record_uri(
        build_space_uri(
            artist.did, settings.atproto.private_media_space_type, "playback"
        ),
        artist.did,
        settings.atproto.track_collection,
        rkey,
    )
    blob = {
        "$type": "blob",
        "ref": {"$link": "bafkprotected"},
        "mimeType": "audio/mpeg",
        "size": 123,
    }
    return {
        "record_uri": uri,
        "record_cid": "bafksource",
        "audio_blob": blob,
        "mirror_verified": False,
    }, {
        "audioBlob": blob,
        "audioFileId": rkey,
        "fileType": "mp3",
        "originalFileId": "master",
        "originalFileType": "aiff",
    }


def public_record(audio: dict, **extra: object) -> dict:
    return {
        "$type": settings.atproto.track_collection,
        "title": "Protected track",
        "artist": "Protected",
        "audioSpace": audio["record_uri"],
        "fileType": "mp3",
        "createdAt": datetime.now(UTC).isoformat(),
        **extra,
    }


@pytest.fixture
async def protected_boundaries(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    monkeypatch.setattr(ingest, "_indexing_excluded", AsyncMock(return_value=False))
    monkeypatch.setattr(ingest, "_check_tombstone", AsyncMock(return_value=False))
    monkeypatch.setattr(ingest, "run_post_track_create_hooks", AsyncMock())
    monkeypatch.setattr(ingest, "run_post_track_audio_replace_hooks", AsyncMock())
    monkeypatch.setattr(ingest, "invalidate_tracks_discovery_cache", AsyncMock())
    monkeypatch.setattr(ingest, "schedule_pds_blob_mirror", AsyncMock())
    resolver = AsyncMock()
    monkeypatch.setattr(ingest, "resolve_protected_audio", resolver, raising=False)
    return resolver


@pytest.mark.parametrize("policy", ["off", "supporters", "open", None])
async def test_rebuild_from_source_ignores_public_audio_url_and_blob_defaults(
    db_session: AsyncSession,
    protected_artist: Artist,
    protected_boundaries: AsyncMock,
    monkeypatch: pytest.MonkeyPatch,
    policy: str | None,
) -> None:
    audio, value = source(protected_artist)
    audio["mirror_verified"] = True
    protected_boundaries.return_value = (audio, value)
    public_probe = AsyncMock(
        side_effect=AssertionError("protected source must not probe public R2")
    )
    monkeypatch.setattr(ingest, "_audio_object_exists", public_probe)
    record = public_record(audio, audioUrl="https://untrusted.example/audio")
    if policy is not None:
        record["downloadPolicy"] = policy
    uri = f"at://{protected_artist.did}/{settings.atproto.track_collection}/rebuild"
    await ingest.ingest_track_create(
        protected_artist.did, "rebuild", record, uri, "bafkpublic"
    )
    track = await db_session.scalar(
        select(Track).where(Track.atproto_record_uri == uri)
    )
    assert track is not None
    assert track.file_id == value["audioFileId"]
    assert track.original_file_id == "master"
    assert track.original_file_type == "aiff"
    assert track.protected_audio == {**audio, "mirror_verified": False}
    assert track.audio_storage == "r2_private"
    assert track.r2_url is None and track.pds_blob_cid is None
    assert track.download_policy == (policy or "off")
    public_probe.assert_not_awaited()


async def test_pending_echo_preserves_reserved_protected_state(
    db_session: AsyncSession,
    protected_artist: Artist,
    protected_boundaries: AsyncMock,
) -> None:
    audio, _ = source(protected_artist)
    audio["mirror_verified"] = True
    track = Track(
        title="reserved",
        artist_did=protected_artist.did,
        file_id="reserved",
        file_type="wav",
        atproto_record_uri=f"at://{protected_artist.did}/{settings.atproto.track_collection}/pending",
        audio_storage="r2_private",
        protected_audio=audio,
        publish_state="pending",
        download_policy="off",
    )
    db_session.add(track)
    await db_session.commit()
    assert track.atproto_record_uri is not None
    await ingest.ingest_track_create(
        protected_artist.did,
        "pending",
        public_record(audio),
        track.atproto_record_uri,
        "bafkpublished",
    )
    await db_session.refresh(track)
    assert track.publish_state == "published"
    assert track.protected_audio == audio
    assert track.file_id == "reserved"
    protected_boundaries.assert_not_awaited()


@pytest.mark.parametrize("change", ["metadata", "omit_pointer", "new_source"])
async def test_updates_preserve_or_resolve_protected_audio(
    db_session: AsyncSession,
    protected_artist: Artist,
    protected_boundaries: AsyncMock,
    change: str,
) -> None:
    audio, value = source(protected_artist)
    audio["mirror_verified"] = True
    track = Track(
        title="old",
        artist_did=protected_artist.did,
        file_id="first",
        file_type="mp3",
        original_file_id="master",
        original_file_type="aiff",
        atproto_record_uri=f"at://{protected_artist.did}/{settings.atproto.track_collection}/update",
        audio_storage="r2_private",
        protected_audio=audio,
        publish_state="published",
        download_policy="off",
    )
    db_session.add(track)
    await db_session.commit()
    record = public_record(audio, title="edited", downloadPolicy="supporters")
    expected = audio
    protected_boundaries.return_value = audio, value
    if change == "omit_pointer":
        record.pop("audioSpace")
        record["audioBlob"] = {"ref": {"$link": "bafkpublicattempt"}}
        record["downloadPolicy"] = "open"
    elif change == "new_source":
        expected, value = source(protected_artist, "second")
        record["audioSpace"] = expected["record_uri"]
        protected_boundaries.return_value = expected, value
    assert track.atproto_record_uri is not None
    await ingest.ingest_track_update(
        protected_artist.did, "update", record, track.atproto_record_uri, "bafkeditted"
    )
    await db_session.refresh(track)
    assert track.title == "edited"
    assert track.protected_audio == expected
    assert track.file_id == ("second" if change == "new_source" else "first")
    assert track.pds_blob_cid is None and track.r2_url is None
    assert track.download_policy == (
        "off" if change == "omit_pointer" else "supporters"
    )
    if change != "omit_pointer":
        protected_boundaries.assert_awaited_once()
    else:
        protected_boundaries.assert_not_awaited()


@pytest.mark.parametrize("invalid", ["foreign_owner", "bad_policy"])
async def test_invalid_source_does_not_publish_a_projection(
    db_session: AsyncSession,
    protected_artist: Artist,
    protected_boundaries: AsyncMock,
    invalid: str,
) -> None:
    audio, value = source(protected_artist)
    protected_boundaries.return_value = audio, value
    record = public_record(audio)
    if invalid == "foreign_owner":
        record["audioSpace"] = record["audioSpace"].replace(
            protected_artist.did, "did:plc:other"
        )
    else:
        record["downloadPolicy"] = "invalid"
    uri = f"at://{protected_artist.did}/{settings.atproto.track_collection}/invalid"
    with pytest.raises((SpaceAccessError, ValueError)):
        await ingest.ingest_track_create(
            protected_artist.did, "invalid", record, uri, "bafkinvalid"
        )
    assert (
        await db_session.scalar(select(Track.id).where(Track.atproto_record_uri == uri))
        is None
    )


@pytest.mark.parametrize(
    "change",
    ["record_cid", "audio_blob", "original_blob", "file_id", "original_file_id"],
)
async def test_same_space_uri_revalidates_mutated_source(
    db_session: AsyncSession,
    protected_artist: Artist,
    protected_boundaries: AsyncMock,
    monkeypatch: pytest.MonkeyPatch,
    change: str,
) -> None:
    audio, _ = source(protected_artist)
    audio["mirror_verified"] = True
    track = Track(
        title="old source",
        artist_did=protected_artist.did,
        file_id="first",
        file_type="mp3",
        original_file_id="master",
        original_file_type="aiff",
        atproto_record_uri=f"at://{protected_artist.did}/{settings.atproto.track_collection}/mutable",
        audio_storage="r2_private",
        protected_audio=audio,
        publish_state="published",
        download_policy="off",
    )
    db_session.add(track)
    await db_session.commit()
    replacement, replacement_value = source(protected_artist)
    if change == "record_cid":
        replacement["record_cid"] = "bafkmodified"
    elif change in ("audio_blob", "original_blob"):
        replacement[change] = {
            **replacement["audio_blob"],
            "ref": {"$link": "bafkreplaced"},
        }
    else:
        replacement_value[
            "audioFileId" if change == "file_id" else "originalFileId"
        ] = "changed"
    protected_boundaries.return_value = replacement, replacement_value
    replaced_hooks = AsyncMock()
    monkeypatch.setattr(ingest, "run_post_track_audio_replace_hooks", replaced_hooks)
    assert track.atproto_record_uri is not None
    await ingest.ingest_track_update(
        protected_artist.did,
        "mutable",
        public_record(audio),
        track.atproto_record_uri,
        "bafkedit",
    )
    await db_session.refresh(track)
    protected_boundaries.assert_awaited_once_with(
        audio["record_uri"], protected_artist.did
    )
    assert track.protected_audio == {**replacement, "mirror_verified": False}
    assert track.file_id == replacement_value["audioFileId"]
    assert track.original_file_id == replacement_value["originalFileId"]
    replaced_hooks.assert_awaited_once_with(track.id)
