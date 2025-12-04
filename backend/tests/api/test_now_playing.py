"""tests for now-playing api endpoints."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, now_playing_service
from backend.config import settings
from backend.main import app
from backend.models import Artist


# create a mock session object
class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:user123", handle: str = "test.user"):
        self.did = did
        self.handle = handle
        self.session_id = "test_session"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked auth."""
    from backend._internal import require_auth

    # mock the auth dependency to return a mock session
    async def mock_require_auth() -> Session:
        return MockSession()

    # override the auth dependency
    app.dependency_overrides[require_auth] = mock_require_auth

    # clear the now_playing_service cache before each test
    now_playing_service._cache.clear()

    yield app

    # cleanup
    app.dependency_overrides.clear()
    now_playing_service._cache.clear()


async def test_update_now_playing(test_app: FastAPI, db_session: AsyncSession):
    """test POST /now-playing updates playback state."""
    payload = {
        "track_id": 123,
        "file_id": "test-file-abc",
        "track_name": "Test Track",
        "artist_name": "Test Artist",
        "album_name": "Test Album",
        "duration_ms": 180000,
        "progress_ms": 30000,
        "is_playing": True,
        "image_url": "https://example.com/cover.jpg",
    }

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post("/now-playing/", json=payload)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

    # verify state was stored
    state = now_playing_service.get("did:test:user123")
    assert state is not None
    assert state.track_name == "Test Track"
    assert state.artist_name == "Test Artist"
    assert state.album_name == "Test Album"
    assert state.duration_ms == 180000
    assert state.progress_ms == 30000
    assert state.is_playing is True


async def test_clear_now_playing(test_app: FastAPI, db_session: AsyncSession):
    """test DELETE /now-playing clears playback state."""
    # first set a state
    now_playing_service.update(
        did="did:test:user123",
        track_name="Test",
        artist_name="Artist",
        album_name=None,
        duration_ms=100000,
        progress_ms=0,
        track_id=1,
        file_id="test",
        track_url="https://plyr.fm/track/1",
        image_url=None,
        is_playing=True,
    )

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.delete("/now-playing/")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

    # verify state was cleared
    state = now_playing_service.get("did:test:user123")
    assert state is None


async def test_get_now_playing_by_handle(test_app: FastAPI, db_session: AsyncSession):
    """test GET /now-playing/by-handle/{handle} returns playback state."""
    # create artist with matching handle
    artist = Artist(
        did="did:test:user123",
        handle="test.user",
        display_name="Test User",
    )
    db_session.add(artist)
    await db_session.commit()

    # set now playing state
    now_playing_service.update(
        did="did:test:user123",
        track_name="Test Track",
        artist_name="Test Artist",
        album_name="Test Album",
        duration_ms=180000,
        progress_ms=45000,
        track_id=123,
        file_id="test-file-abc",
        track_url="https://plyr.fm/track/123",
        image_url="https://example.com/cover.jpg",
        is_playing=True,
    )

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/now-playing/by-handle/test.user")

    assert response.status_code == 200
    data = response.json()

    assert data["track_name"] == "Test Track"
    assert data["artist_name"] == "Test Artist"
    assert data["album_name"] == "Test Album"
    assert data["duration_ms"] == 180000
    assert data["progress_ms"] == 45000
    assert data["is_playing"] is True
    assert data["track_id"] == 123
    assert data["file_id"] == "test-file-abc"
    assert data["track_url"] == "https://plyr.fm/track/123"
    assert data["image_url"] == "https://example.com/cover.jpg"
    assert data["service_base_url"] == settings.frontend.domain


async def test_get_now_playing_by_handle_returns_204_when_not_playing(
    test_app: FastAPI, db_session: AsyncSession
):
    """test GET /now-playing/by-handle/{handle} returns 204 when nothing playing."""
    # create artist
    artist = Artist(
        did="did:test:user123",
        handle="test.user",
        display_name="Test User",
    )
    db_session.add(artist)
    await db_session.commit()

    # no now playing state set

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/now-playing/by-handle/test.user")

    assert response.status_code == 204


async def test_get_now_playing_by_handle_returns_204_when_paused(
    test_app: FastAPI, db_session: AsyncSession
):
    """test GET /now-playing/by-handle/{handle} returns 204 when paused."""
    # create artist
    artist = Artist(
        did="did:test:user123",
        handle="test.user",
        display_name="Test User",
    )
    db_session.add(artist)
    await db_session.commit()

    # set state with is_playing=False
    now_playing_service.update(
        did="did:test:user123",
        track_name="Test Track",
        artist_name="Test Artist",
        album_name=None,
        duration_ms=180000,
        progress_ms=45000,
        track_id=123,
        file_id="test-file-abc",
        track_url="https://plyr.fm/track/123",
        image_url=None,
        is_playing=False,  # paused
    )

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/now-playing/by-handle/test.user")

    assert response.status_code == 204


async def test_get_now_playing_by_handle_returns_404_for_unknown_user(
    test_app: FastAPI, db_session: AsyncSession
):
    """test GET /now-playing/by-handle/{handle} returns 404 for unknown handle."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/now-playing/by-handle/unknown.user")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


async def test_get_now_playing_by_did(test_app: FastAPI, db_session: AsyncSession):
    """test GET /now-playing/by-did/{did} returns playback state."""
    # set now playing state
    now_playing_service.update(
        did="did:test:user123",
        track_name="Test Track",
        artist_name="Test Artist",
        album_name=None,
        duration_ms=180000,
        progress_ms=60000,
        track_id=456,
        file_id="test-file-xyz",
        track_url="https://plyr.fm/track/456",
        image_url=None,
        is_playing=True,
    )

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/now-playing/by-did/did:test:user123")

    assert response.status_code == 200
    data = response.json()

    assert data["track_name"] == "Test Track"
    assert data["artist_name"] == "Test Artist"
    assert data["is_playing"] is True
    assert data["service_base_url"] == settings.frontend.domain


async def test_get_now_playing_by_did_returns_204_when_not_playing(
    test_app: FastAPI, db_session: AsyncSession
):
    """test GET /now-playing/by-did/{did} returns 204 when nothing playing."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/now-playing/by-did/did:test:unknown")

    assert response.status_code == 204


async def test_now_playing_state_isolated_by_user(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that different users have isolated now-playing states."""
    # set states for two different users
    now_playing_service.update(
        did="did:test:user1",
        track_name="Track 1",
        artist_name="Artist 1",
        album_name=None,
        duration_ms=100000,
        progress_ms=10000,
        track_id=1,
        file_id="file1",
        track_url="https://plyr.fm/track/1",
        image_url=None,
        is_playing=True,
    )

    now_playing_service.update(
        did="did:test:user2",
        track_name="Track 2",
        artist_name="Artist 2",
        album_name=None,
        duration_ms=200000,
        progress_ms=20000,
        track_id=2,
        file_id="file2",
        track_url="https://plyr.fm/track/2",
        image_url=None,
        is_playing=True,
    )

    # verify states are isolated
    state1 = now_playing_service.get("did:test:user1")
    state2 = now_playing_service.get("did:test:user2")

    assert state1 is not None
    assert state2 is not None
    assert state1.track_name == "Track 1"
    assert state2.track_name == "Track 2"


async def test_update_now_playing_without_album(
    test_app: FastAPI, db_session: AsyncSession
):
    """test POST /now-playing works without optional album_name."""
    payload = {
        "track_id": 123,
        "file_id": "test-file-abc",
        "track_name": "Single Track",
        "artist_name": "Solo Artist",
        "duration_ms": 180000,
        "progress_ms": 0,
        "is_playing": True,
    }

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post("/now-playing/", json=payload)

    assert response.status_code == 200

    state = now_playing_service.get("did:test:user123")
    assert state is not None
    assert state.album_name is None
    assert state.image_url is None
