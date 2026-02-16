"""tests for social graph discovery endpoint."""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import Artist, Track


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:viewer"):
        self.did = did
        self.handle = "viewer.bsky.social"
        self.session_id = "test_session_id"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": did,
            "handle": "viewer.bsky.social",
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
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked auth."""

    async def mock_require_auth() -> Session:
        return MockSession()

    app.dependency_overrides[require_auth] = mock_require_auth
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def artist_with_tracks(db_session: AsyncSession) -> Artist:
    """artist who has uploaded tracks."""
    artist = Artist(
        did="did:plc:has_tracks",
        handle="musician.bsky.social",
        display_name="Active Musician",
    )
    db_session.add(artist)
    await db_session.flush()

    for i in range(3):
        db_session.add(
            Track(
                title=f"Song {i}",
                file_id=f"file_{i}",
                file_type="audio/mpeg",
                artist_did=artist.did,
            )
        )
    await db_session.commit()
    return artist


@pytest.fixture
async def artist_without_tracks(db_session: AsyncSession) -> Artist:
    """artist who exists but has no tracks — must be excluded from results."""
    artist = Artist(
        did="did:plc:no_tracks",
        handle="lurker.bsky.social",
        display_name="Silent Listener",
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


async def test_network_excludes_artists_with_zero_tracks(
    test_app: FastAPI,
    db_session: AsyncSession,
    artist_with_tracks: Artist,
    artist_without_tracks: Artist,
) -> None:
    """regression: artists with 0 tracks must not appear in network results.

    the viewer follows both artists on bluesky, but only the one with
    tracks should be returned.
    """
    with patch(
        "backend.api.discover._get_follows",
        new_callable=AsyncMock,
        return_value={artist_with_tracks.did, artist_without_tracks.did},
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get("/discover/network")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["did"] == artist_with_tracks.did
    assert data[0]["track_count"] == 3


async def test_network_returns_empty_when_no_follows_are_artists(
    test_app: FastAPI,
    db_session: AsyncSession,
) -> None:
    """returns empty list when none of the user's follows are on plyr.fm."""
    with patch(
        "backend.api.discover._get_follows",
        new_callable=AsyncMock,
        return_value={"did:plc:stranger1", "did:plc:stranger2"},
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get("/discover/network")

    assert response.status_code == 200
    assert response.json() == []


async def test_network_returns_empty_when_no_follows(
    test_app: FastAPI,
    db_session: AsyncSession,
) -> None:
    """returns empty list when user follows nobody."""
    with patch(
        "backend.api.discover._get_follows",
        new_callable=AsyncMock,
        return_value=set(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get("/discover/network")

    assert response.status_code == 200
    assert response.json() == []
