"""tests for URL origin trust validation during Jetstream ingest."""

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.tasks.ingest import (
    ingest_track_create,
    ingest_track_update,
)
from backend._internal.tasks.origin_trust import (
    is_trusted_audio_origin,
    is_trusted_image_origin,
)
from backend.models import Artist, Track


def _recent_ts() -> str:
    return datetime.now(UTC).isoformat()


# --- fixtures ---


@pytest.fixture(autouse=True)
def _mock_post_create_hooks():
    with patch(
        "backend._internal.tasks.ingest.run_post_track_create_hooks",
        new_callable=AsyncMock,
    ):
        yield


@pytest.fixture(autouse=True)
def _mock_trusted_origins():
    with (
        patch(
            "backend._internal.tasks.origin_trust.settings.storage.r2_public_bucket_url",
            "https://r2.example.com",
        ),
        patch(
            "backend._internal.tasks.origin_trust.settings.storage.r2_public_image_bucket_url",
            "https://images.example.com",
        ),
    ):
        yield


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    did = f"did:plc:origin_{uuid.uuid4().hex[:12]}"
    a = Artist(
        did=did,
        handle="origintest.bsky.social",
        display_name="Origin Test Artist",
        pds_url="https://bsky.social",
    )
    db_session.add(a)
    await db_session.commit()
    return a


@pytest.fixture
async def track(db_session: AsyncSession, artist: Artist) -> Track:
    t = Track(
        title="Origin Test Track",
        file_id="origin_abc",
        file_type="mp3",
        artist_did=artist.did,
        r2_url="https://r2.example.com/origin_abc.mp3",
        atproto_record_uri=f"at://{artist.did}/fm.plyr.track/origin_existing",
        atproto_record_cid="bafyorigin",
        audio_storage="r2",
    )
    db_session.add(t)
    await db_session.commit()
    return t


# --- unit tests ---


class TestOriginTrustFunctions:
    async def test_trusted_audio_origin(self) -> None:
        assert await is_trusted_audio_origin(
            "https://r2.example.com/file.mp3", artist_did="did:plc:test"
        )

    async def test_untrusted_audio_origin(self) -> None:
        assert not await is_trusted_audio_origin(
            "https://evil.com/file.mp3", artist_did="did:plc:test"
        )

    async def test_empty_audio_url_trusted(self) -> None:
        assert await is_trusted_audio_origin("", artist_did="did:plc:test")

    async def test_trusted_image_origin(self) -> None:
        assert await is_trusted_image_origin(
            "https://images.example.com/pic.jpg", artist_did="did:plc:test"
        )

    async def test_untrusted_image_origin(self) -> None:
        assert not await is_trusted_image_origin(
            "https://evil.com/pic.jpg", artist_did="did:plc:test"
        )

    async def test_empty_image_url_trusted(self) -> None:
        assert await is_trusted_image_origin("", artist_did="did:plc:test")


# --- integration tests: create ---


class TestOriginValidationOnCreate:
    async def test_trusted_audio_url_accepted(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """audioUrl from R2 CDN is accepted normally."""
        record = {
            "title": "Trusted Audio",
            "artist": "Test",
            "fileId": "trusted_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/trusted_001.mp3",
            "createdAt": _recent_ts(),
        }
        uri = f"at://{artist.did}/fm.plyr.track/trusted1"

        await ingest_track_create(
            did=artist.did, rkey="trusted1", record=record, uri=uri, cid="bafytrust"
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        track = result.scalar_one()
        assert track.r2_url == "https://r2.example.com/trusted_001.mp3"
        assert track.audio_storage == "r2"

    async def test_untrusted_audio_url_with_blob_stripped(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """untrusted audioUrl + audioBlob -> audioUrl stripped, stored as pds-only."""
        record = {
            "title": "Untrusted With Blob",
            "artist": "Test",
            "fileId": "untrusted_blob_001",
            "fileType": "mp3",
            "audioUrl": "https://evil.com/malicious.mp3",
            "audioBlob": {"ref": {"$link": "bafysafeblob"}, "mimeType": "audio/mpeg"},
            "createdAt": _recent_ts(),
        }
        uri = f"at://{artist.did}/fm.plyr.track/untrusted_blob1"

        await ingest_track_create(
            did=artist.did,
            rkey="untrusted_blob1",
            record=record,
            uri=uri,
            cid="bafyub",
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        track = result.scalar_one()
        assert track.r2_url is None
        assert track.audio_storage == "pds"
        assert track.pds_blob_cid == "bafysafeblob"

    async def test_untrusted_audio_url_no_blob_rejected(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """untrusted audioUrl + no audioBlob -> track rejected entirely."""
        record = {
            "title": "Untrusted No Blob",
            "artist": "Test",
            "fileId": "untrusted_noblob_001",
            "fileType": "mp3",
            "audioUrl": "https://evil.com/malicious.mp3",
            "createdAt": _recent_ts(),
        }
        uri = f"at://{artist.did}/fm.plyr.track/untrusted_noblob1"

        await ingest_track_create(
            did=artist.did,
            rkey="untrusted_noblob1",
            record=record,
            uri=uri,
            cid="bafyun",
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        assert result.scalar_one_or_none() is None

    async def test_untrusted_image_url_stripped(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """untrusted imageUrl is stripped (set to None) on create."""
        record = {
            "title": "Bad Image",
            "artist": "Test",
            "fileId": "badimg_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/badimg_001.mp3",
            "imageUrl": "https://evil.com/tracking-pixel.png",
            "createdAt": _recent_ts(),
        }
        uri = f"at://{artist.did}/fm.plyr.track/badimg1"

        await ingest_track_create(
            did=artist.did, rkey="badimg1", record=record, uri=uri, cid="bafyimg"
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        track = result.scalar_one()
        assert track.image_url is None

    async def test_trusted_image_url_accepted(
        self, db_session: AsyncSession, artist: Artist
    ) -> None:
        """trusted imageUrl is kept on create."""
        record = {
            "title": "Good Image",
            "artist": "Test",
            "fileId": "goodimg_001",
            "fileType": "mp3",
            "audioUrl": "https://r2.example.com/goodimg_001.mp3",
            "imageUrl": "https://images.example.com/art.jpg",
            "createdAt": _recent_ts(),
        }
        uri = f"at://{artist.did}/fm.plyr.track/goodimg1"

        await ingest_track_create(
            did=artist.did, rkey="goodimg1", record=record, uri=uri, cid="bafygoodimg"
        )

        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        track = result.scalar_one()
        assert track.image_url == "https://images.example.com/art.jpg"


# --- integration tests: update ---


class TestOriginValidationOnUpdate:
    async def test_untrusted_audio_url_stripped(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """untrusted audioUrl is stripped on update (doesn't reject the update)."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        original_r2_url = track.r2_url

        await ingest_track_update(
            did=artist.did,
            rkey="origin_existing",
            record={
                "audioUrl": "https://evil.com/malicious.mp3",
                "title": "Updated Title",
            },
            uri=uri,
            cid="bafyupd",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        updated = result.scalar_one()
        assert updated.title == "Updated Title"
        assert updated.r2_url == original_r2_url

    async def test_untrusted_image_url_stripped(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """untrusted imageUrl is not applied on update."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri
        track.image_url = "https://images.example.com/original.jpg"
        await db_session.commit()

        await ingest_track_update(
            did=artist.did,
            rkey="origin_existing",
            record={"imageUrl": "https://evil.com/tracking-pixel.png"},
            uri=uri,
            cid="bafybadimg",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        updated = result.scalar_one()
        assert updated.image_url == "https://images.example.com/original.jpg"

    async def test_trusted_audio_url_accepted(
        self, db_session: AsyncSession, artist: Artist, track: Track
    ) -> None:
        """trusted audioUrl is accepted on update."""
        assert track.atproto_record_uri is not None
        uri = track.atproto_record_uri

        await ingest_track_update(
            did=artist.did,
            rkey="origin_existing",
            record={"audioUrl": "https://r2.example.com/updated.mp3"},
            uri=uri,
            cid="bafytrustedupd",
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Track).where(Track.atproto_record_uri == uri)
        )
        updated = result.scalar_one()
        assert updated.r2_url == "https://r2.example.com/updated.mp3"
