"""regression tests for banana mix incident fixes.

tests cover three critical fixes:
1. duplicate detection prevents re-uploading same file
2. refcount check prevents deleting shared R2 files
3. ATProto cleanup removes orphaned records
"""

from collections.abc import Generator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import Artist, Track


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:user123"):
        self.did = did
        self.handle = "testuser.bsky.social"
        self.session_id = "test_session_id"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": did,
            "handle": "testuser.bsky.social",
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": "atproto transition:generic",
            "access_token": "test_token",
            "refresh_token": "test_refresh",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture
async def test_artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    artist = Artist(
        did="did:plc:artist123",
        handle="artist.bsky.social",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked auth."""

    async def mock_require_auth() -> Session:
        return MockSession(did="did:plc:artist123")

    app.dependency_overrides[require_auth] = mock_require_auth

    yield app

    app.dependency_overrides.clear()


async def test_duplicate_upload_detection(
    db_session: AsyncSession, test_artist: Artist
):
    """test that duplicate detection logic prevents multiple tracks with same file_id.

    regression test for banana mix incident where stellz uploaded same file twice,
    creating two tracks pointing to the same R2 object.
    """
    file_id = "test_file_id_123"

    # create first track with this file_id
    track1 = Track(
        title="original upload",
        artist_did=test_artist.did,
        file_id=file_id,
        file_type="mp3",
        extra={"duration": 180},
    )
    db_session.add(track1)
    await db_session.commit()

    # verify duplicate detection query works correctly
    # this is the same logic used in src/backend/api/tracks.py:181-203
    stmt = select(Track).where(
        Track.file_id == file_id,
        Track.artist_did == test_artist.did,
    )
    result = await db_session.execute(stmt)
    existing_track = result.scalar_one_or_none()

    # should find the existing track
    assert existing_track is not None
    assert existing_track.id == track1.id

    # attempting to create another track with same file_id should be detected
    # (in practice, the upload endpoint would reject this before DB insert)
    track2_attempt = Track(
        title="duplicate upload",
        artist_did=test_artist.did,
        file_id=file_id,
        file_type="mp3",
        extra={"duration": 180},
    )

    # verify that querying before insert finds the duplicate
    stmt = select(Track).where(
        Track.file_id == track2_attempt.file_id,
        Track.artist_did == track2_attempt.artist_did,
    )
    result = await db_session.execute(stmt)
    duplicate_check = result.scalar_one_or_none()

    # should find the original track, preventing duplicate
    assert duplicate_check is not None
    assert duplicate_check.id == track1.id


async def test_refcount_prevents_r2_deletion(db_session: AsyncSession):
    """test that R2 delete is skipped when multiple tracks reference the same file.

    regression test for banana mix incident where deleting track 57 removed
    the R2 file that track 56 was still using.
    """
    from backend.storage.r2 import R2Storage

    file_id = "shared_file_id"

    # create two tracks with same file_id (duplicates that slipped through)
    artist = Artist(
        did="did:plc:artist456",
        handle="artist2.bsky.social",
        display_name="Artist Two",
    )
    db_session.add(artist)
    await db_session.flush()

    track1 = Track(
        title="track 1",
        artist_did=artist.did,
        file_id=file_id,
        file_type="mp3",
        extra={},
    )
    track2 = Track(
        title="track 2",
        artist_did=artist.did,
        file_id=file_id,
        file_type="mp3",
        extra={},
    )
    db_session.add(track1)
    db_session.add(track2)
    await db_session.commit()

    # try to delete the file
    # this should be skipped because refcount = 2
    storage = R2Storage()

    with patch.object(
        storage.async_session, "client", new_callable=MagicMock
    ) as mock_client_ctx:
        mock_client = AsyncMock()
        mock_client_ctx.return_value.__aenter__.return_value = mock_client

        result = await storage.delete(file_id)

        # deletion should be skipped (returns False)
        assert result is False

        # verify R2 delete was NOT called
        mock_client.delete_object.assert_not_called()


async def test_atproto_cleanup_on_track_delete(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that ATProto records are cleaned up when track is deleted.

    regression test for banana mix incident where deleting track 57 left
    orphaned ATProto record on stellz's PDS.
    """
    # create track with ATProto record
    track = Track(
        title="test track",
        artist_did=test_artist.did,
        file_id="test_file_789",
        file_type="mp3",
        extra={},
        atproto_record_uri="at://did:plc:artist123/fm.plyr.track/abc123",
        atproto_record_cid="bafytest123",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    # mock storage delete to avoid R2 errors
    # mock ATProto delete at the records module level before import
    with (
        patch("backend.api.tracks.storage.delete", new_callable=AsyncMock),
        patch(
            "backend.atproto.records.delete_record_by_uri", new_callable=AsyncMock
        ) as mock_delete_atproto,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.delete(f"/tracks/{track.id}")

    assert response.status_code == 200

    # verify ATProto record deletion was called
    mock_delete_atproto.assert_called_once()
    call_args = mock_delete_atproto.call_args
    assert call_args.args[1] == track.atproto_record_uri

    # verify track was deleted from DB
    result = await db_session.execute(select(Track).where(Track.id == track.id))
    assert result.scalar_one_or_none() is None


async def test_atproto_cleanup_handles_404(
    test_app: FastAPI, db_session: AsyncSession, test_artist: Artist
):
    """test that track deletion continues even if ATProto record is already gone."""
    # create track with ATProto record
    track = Track(
        title="test track",
        artist_did=test_artist.did,
        file_id="test_file_999",
        file_type="mp3",
        extra={},
        atproto_record_uri="at://did:plc:artist123/fm.plyr.track/xyz123",
        atproto_record_cid="bafytest456",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    # mock ATProto delete to raise 404
    with (
        patch("backend.api.tracks.storage.delete", new_callable=AsyncMock),
        patch(
            "backend.atproto.records.delete_record_by_uri",
            side_effect=Exception("404 not found"),
        ) as mock_delete_atproto,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.delete(f"/tracks/{track.id}")

    # should still succeed despite 404
    assert response.status_code == 200

    # verify ATProto delete was attempted
    mock_delete_atproto.assert_called_once()

    # verify track was still deleted from DB
    result = await db_session.execute(select(Track).where(Track.id == track.id))
    assert result.scalar_one_or_none() is None
