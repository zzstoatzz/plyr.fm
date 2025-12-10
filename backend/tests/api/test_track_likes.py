"""tests for track like api endpoints and error handling."""

from collections.abc import Generator
from unittest.mock import patch

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
    """test successful track like creates DB entry and schedules PDS record creation."""
    with patch("backend.api.tracks.likes.schedule_pds_create_like") as mock_schedule:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(f"/tracks/{test_track.id}/like")

    assert response.status_code == 200
    assert response.json()["liked"] is True

    # verify background task was scheduled
    mock_schedule.assert_called_once()
    call_kwargs = mock_schedule.call_args.kwargs
    assert call_kwargs["subject_uri"] == test_track.atproto_record_uri
    assert call_kwargs["subject_cid"] == test_track.atproto_record_cid

    # verify DB entry exists (created immediately, before PDS)
    result = await db_session.execute(
        select(TrackLike).where(
            TrackLike.track_id == test_track.id,
            TrackLike.user_did == "did:test:user123",
        )
    )
    like = result.scalar_one_or_none()
    assert like is not None
    # atproto_like_uri is None initially - will be set by background task
    assert like.atproto_like_uri is None


async def test_like_track_db_entry_has_correct_like_id(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test that the like_id passed to background task matches the DB record."""
    with patch("backend.api.tracks.likes.schedule_pds_create_like") as mock_schedule:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            await client.post(f"/tracks/{test_track.id}/like")

    # get the like_id from the scheduled call
    call_kwargs = mock_schedule.call_args.kwargs
    scheduled_like_id = call_kwargs["like_id"]

    # verify it matches the DB record
    result = await db_session.execute(
        select(TrackLike).where(
            TrackLike.track_id == test_track.id,
            TrackLike.user_did == "did:test:user123",
        )
    )
    like = result.scalar_one()
    assert like.id == scheduled_like_id


async def test_unlike_track_success(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test successful track unlike removes DB entry and schedules PDS record deletion."""
    # create existing like
    like = TrackLike(
        track_id=test_track.id,
        user_did="did:test:user123",
        atproto_like_uri="at://did:test:user123/fm.plyr.like/abc123",
    )
    db_session.add(like)
    await db_session.commit()

    with patch("backend.api.tracks.likes.schedule_pds_delete_like") as mock_schedule:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.delete(f"/tracks/{test_track.id}/like")

    assert response.status_code == 200
    assert response.json()["liked"] is False

    # verify background task was scheduled with correct URI
    mock_schedule.assert_called_once()
    call_kwargs = mock_schedule.call_args.kwargs
    assert call_kwargs["like_uri"] == "at://did:test:user123/fm.plyr.like/abc123"

    # verify DB entry is gone (deleted immediately, before PDS)
    result = await db_session.execute(
        select(TrackLike).where(
            TrackLike.track_id == test_track.id,
            TrackLike.user_did == "did:test:user123",
        )
    )
    assert result.scalar_one_or_none() is None


async def test_unlike_track_without_atproto_uri(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test that unliking a track without ATProto URI doesn't schedule deletion."""
    # create like without ATProto URI (e.g., background task hasn't run yet)
    like = TrackLike(
        track_id=test_track.id,
        user_did="did:test:user123",
        atproto_like_uri=None,
    )
    db_session.add(like)
    await db_session.commit()

    with patch("backend.api.tracks.likes.schedule_pds_delete_like") as mock_schedule:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.delete(f"/tracks/{test_track.id}/like")

    assert response.status_code == 200
    assert response.json()["liked"] is False

    # no PDS deletion should be scheduled since there's no ATProto record
    mock_schedule.assert_not_called()

    # verify DB entry is still gone
    result = await db_session.execute(
        select(TrackLike).where(
            TrackLike.track_id == test_track.id,
            TrackLike.user_did == "did:test:user123",
        )
    )
    assert result.scalar_one_or_none() is None


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

    with patch("backend.api.tracks.likes.schedule_pds_create_like") as mock_schedule:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(f"/tracks/{test_track.id}/like")

    assert response.status_code == 200
    assert response.json()["liked"] is True

    # verify no new background task was scheduled
    mock_schedule.assert_not_called()


async def test_unlike_not_liked_track_idempotent(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
):
    """test that unliking a not-liked track is idempotent."""
    with patch("backend.api.tracks.likes.schedule_pds_delete_like") as mock_schedule:
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.delete(f"/tracks/{test_track.id}/like")

    assert response.status_code == 200
    assert response.json()["liked"] is False

    # verify no background task was scheduled
    mock_schedule.assert_not_called()


async def test_like_track_missing_atproto_record(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that liking a track without ATProto record returns 422."""
    # create artist
    artist = Artist(
        did="did:plc:artist456",
        handle="artist2.bsky.social",
        display_name="Test Artist 2",
    )
    db_session.add(artist)
    await db_session.flush()

    # create track WITHOUT ATProto record
    track = Track(
        title="No ATProto Track",
        artist_did=artist.did,
        file_id="noatproto123",
        file_type="mp3",
        atproto_record_uri=None,
        atproto_record_cid=None,
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(f"/tracks/{track.id}/like")

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["error"] == "missing_atproto_record"


async def test_like_nonexistent_track(test_app: FastAPI):
    """test that liking a nonexistent track returns 404."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post("/tracks/99999/like")

    assert response.status_code == 404
    assert response.json()["detail"] == "track not found"
