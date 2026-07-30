"""regression tests for staged-upload cleanup deleting a published track's audio.

A `file_id` is a content hash, so re-uploading a file you already published
stages the exact R2 key your live track is served from. The upload then fails
the duplicate check and the orchestrator cleans up "its" staged object — which
is the published track's only copy in R2. Four of boulyprod's tracks were
deleted this way on 2026-07-18; the pattern accounts for 20 broken tracks
across 7 artists.

`delete()` tolerates a single reference because a track being deleted is itself
that reference. `discard_staged()` must not: nothing references a genuinely
staged object.
"""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Artist, Track
from backend.storage.r2 import R2Storage

PUBLISHED_FILE_ID = "b9deb36a0475b377"


@pytest.fixture
def storage() -> R2Storage:
    with patch.object(R2Storage, "__init__", lambda self: None):
        instance = R2Storage()
    instance.audio_bucket_name = "audio-test"
    instance.image_bucket_name = "images-test"
    instance.private_audio_bucket_name = "audio-private-test"
    return instance


@pytest.fixture
def s3(storage: R2Storage) -> MagicMock:
    """mock only the S3 boundary, so the refcount query runs for real."""
    client = MagicMock()
    client.head_object = AsyncMock(return_value={})
    client.delete_object = AsyncMock(return_value={})
    client.exceptions.NoSuchKey = type("NoSuchKey", (Exception,), {})

    @asynccontextmanager
    async def _client(**_: object):
        yield client

    storage._s3_client = _client  # type: ignore[method-assign]
    return client


@pytest.fixture
async def published_track(db_session: AsyncSession) -> Track:
    artist = Artist(
        did="did:plc:boulyprod",
        handle="boulyprod.eurosky.social",
        display_name="boulyprod",
    )
    db_session.add(artist)
    await db_session.flush()
    track = Track(
        title="published",
        artist_did=artist.did,
        file_id=PUBLISHED_FILE_ID,
        file_type="wav",
        extra={},
    )
    db_session.add(track)
    await db_session.commit()
    return track


async def test_discard_staged_keeps_a_published_tracks_audio(
    storage: R2Storage, s3: MagicMock, published_track: Track
) -> None:
    """the re-upload case: the staged key is already a live track's audio."""
    assert await storage.discard_staged(PUBLISHED_FILE_ID, "wav") is False
    s3.delete_object.assert_not_awaited()


async def test_discard_staged_keeps_audio_referenced_as_a_lossless_source(
    storage: R2Storage, s3: MagicMock, db_session: AsyncSession
) -> None:
    """a track's `original_file_id` is an object too, and refcount must see it."""
    artist = Artist(did="did:plc:woody", handle="woody.fm", display_name="woody")
    db_session.add(artist)
    await db_session.flush()
    db_session.add(
        Track(
            title="optimized",
            artist_did=artist.did,
            file_id="the-mp3-rendition",
            file_type="mp3",
            original_file_id=PUBLISHED_FILE_ID,
            original_file_type="aif",
            extra={},
        )
    )
    await db_session.commit()

    assert await storage.discard_staged(PUBLISHED_FILE_ID, "aif") is False
    s3.delete_object.assert_not_awaited()


async def test_discard_staged_deletes_a_genuinely_orphaned_object(
    storage: R2Storage, s3: MagicMock, db_session: AsyncSession
) -> None:
    """cleanup still works when the upload really did leave an orphan."""
    assert await storage.discard_staged("no-track-points-here", "wav") is True
    s3.delete_object.assert_awaited_once()


async def test_upload_cleanup_keeps_a_published_tracks_audio(
    storage: R2Storage, s3: MagicMock, published_track: Track
) -> None:
    """the real call site: the upload orchestrator's staged-media cleanup.

    This is the path that ran on 2026-07-18 — phase 3 rejected the re-upload as
    a duplicate, and cleanup then deleted the duplicate's audio.
    """
    from backend.api.tracks.uploads import _delete_staged_audio

    with patch("backend.api.tracks.uploads.storage", storage):
        await _delete_staged_audio(PUBLISHED_FILE_ID, "wav", gated=False)

    s3.delete_object.assert_not_awaited()


async def test_delete_still_removes_the_media_of_the_track_being_deleted(
    storage: R2Storage, s3: MagicMock, published_track: Track
) -> None:
    """the contrast that makes the two verbs distinct.

    `delete()` sees the same refcount of 1 and proceeds — correct for track
    deletion, and precisely the behaviour that destroyed audio when the staged
    cleanup path borrowed it.
    """
    assert await storage.delete(PUBLISHED_FILE_ID, "wav") is True
    s3.delete_object.assert_awaited_once()
