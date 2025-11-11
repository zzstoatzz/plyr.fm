"""tests for track like api endpoints and error handling."""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import Artist, Track, TrackLike


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
async def test_track(db_session: AsyncSession) -> Track:
    """create a test track with artist."""
    # create artist
    artist = Artist(
        did="did:plc:artist123",
        handle="artist.bsky.social",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    # create track
    track = Track(
        title="Test Track",
        artist_did=artist.did,
        file_id="test123",
        file_type="mp3",
        extra={"duration": 180},
        atproto_record_uri="at://did:plc:artist123/fm.plyr.track/test123",
        atproto_record_cid="bafytest123",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    return track


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked auth."""

    async def mock_require_auth() -> Session:
        return MockSession()

    app.dependency_overrides[require_auth] = mock_require_auth

    yield app

    app.dependency_overrides.clear()


async def test_like_track_success(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test successful track like creates ATProto record and DB entry."""
    with patch("backend.api.tracks.create_like_record") as mock_create:
        mock_create.return_value = "at://did:test:user123/fm.plyr.like/abc123"

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(f"/tracks/{test_track.id}/like")

    assert response.status_code == 200
    assert response.json()["liked"] is True

    # verify ATProto record was created
    mock_create.assert_called_once()

    # verify DB entry exists
    result = await db_session.execute(
        select(TrackLike).where(
            TrackLike.track_id == test_track.id,
            TrackLike.user_did == "did:test:user123",
        )
    )
    like = result.scalar_one_or_none()
    assert like is not None
    assert like.atproto_like_uri == "at://did:test:user123/fm.plyr.like/abc123"


async def test_like_track_cleanup_on_db_failure(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test that ATProto record is cleaned up if DB commit fails."""
    created_uri = "at://did:test:user123/fm.plyr.like/abc123"

    # create a mock session that fails on commit
    mock_db = AsyncMock(spec=AsyncSession)
    mock_db.execute = db_session.execute
    mock_db.add = db_session.add
    mock_db.delete = db_session.delete
    mock_db.flush = db_session.flush
    mock_db.refresh = db_session.refresh
    mock_db.commit = AsyncMock(side_effect=Exception("DB error"))

    async def mock_get_db():
        yield mock_db

    from backend.models import get_db

    test_app.dependency_overrides[get_db] = mock_get_db

    with (
        patch("backend.api.tracks.create_like_record") as mock_create,
        patch("backend.api.tracks.delete_record_by_uri") as mock_delete,
    ):
        mock_create.return_value = created_uri

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(f"/tracks/{test_track.id}/like")

    # should return 500 error
    assert response.status_code == 500
    assert "failed to like track" in response.json()["detail"]

    # verify cleanup was attempted
    mock_delete.assert_called_once()
    call_args = mock_delete.call_args
    assert call_args.kwargs["record_uri"] == created_uri

    # cleanup override
    del test_app.dependency_overrides[get_db]


async def test_unlike_track_success(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test successful track unlike deletes ATProto record and DB entry."""
    # create existing like
    like = TrackLike(
        track_id=test_track.id,
        user_did="did:test:user123",
        atproto_like_uri="at://did:test:user123/fm.plyr.like/abc123",
    )
    db_session.add(like)
    await db_session.commit()

    with patch("backend.api.tracks.delete_record_by_uri") as mock_delete:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.delete(f"/tracks/{test_track.id}/like")

    assert response.status_code == 200
    assert response.json()["liked"] is False

    # verify ATProto record was deleted
    mock_delete.assert_called_once()

    # verify DB entry is gone
    result = await db_session.execute(
        select(TrackLike).where(
            TrackLike.track_id == test_track.id,
            TrackLike.user_did == "did:test:user123",
        )
    )
    assert result.scalar_one_or_none() is None


async def test_unlike_track_rollback_on_db_failure(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test that ATProto record is recreated if DB commit fails during unlike."""
    like_uri = "at://did:test:user123/fm.plyr.like/abc123"

    # create existing like
    like = TrackLike(
        track_id=test_track.id,
        user_did="did:test:user123",
        atproto_like_uri=like_uri,
    )
    db_session.add(like)
    await db_session.commit()

    # create a mock session that fails on commit
    mock_db = AsyncMock(spec=AsyncSession)
    mock_db.execute = db_session.execute
    mock_db.add = db_session.add
    mock_db.delete = db_session.delete
    mock_db.flush = db_session.flush
    mock_db.refresh = db_session.refresh
    mock_db.commit = AsyncMock(side_effect=Exception("DB error"))

    async def mock_get_db():
        yield mock_db

    from backend.models import get_db

    test_app.dependency_overrides[get_db] = mock_get_db

    with (
        patch("backend.api.tracks.delete_record_by_uri") as mock_delete,
        patch("backend.api.tracks.create_like_record") as mock_create,
    ):
        mock_create.return_value = "at://did:test:user123/fm.plyr.like/new123"

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.delete(f"/tracks/{test_track.id}/like")

    # should return 500 error
    assert response.status_code == 500
    assert "failed to unlike track" in response.json()["detail"]

    # verify ATProto record was deleted
    mock_delete.assert_called_once()

    # verify rollback was attempted (recreate the like)
    mock_create.assert_called_once()
    call_args = mock_create.call_args
    assert call_args.kwargs["subject_uri"] == test_track.atproto_record_uri
    assert call_args.kwargs["subject_cid"] == test_track.atproto_record_cid

    # cleanup override
    del test_app.dependency_overrides[get_db]


async def test_like_already_liked_track_idempotent(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test that liking an already-liked track is idempotent."""
    # create existing like
    like = TrackLike(
        track_id=test_track.id,
        user_did="did:test:user123",
        atproto_like_uri="at://did:test:user123/fm.plyr.like/abc123",
    )
    db_session.add(like)
    await db_session.commit()

    with patch("backend.api.tracks.create_like_record") as mock_create:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(f"/tracks/{test_track.id}/like")

    assert response.status_code == 200
    assert response.json()["liked"] is True

    # verify no new ATProto record was created
    mock_create.assert_not_called()


async def test_unlike_not_liked_track_idempotent(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test that unliking a not-liked track is idempotent."""
    with patch("backend.api.tracks.delete_record_by_uri") as mock_delete:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.delete(f"/tracks/{test_track.id}/like")

    assert response.status_code == 200
    assert response.json()["liked"] is False

    # verify no ATProto record deletion was attempted
    mock_delete.assert_not_called()
