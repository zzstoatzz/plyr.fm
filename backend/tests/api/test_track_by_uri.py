"""tests for track lookup by AT-URI endpoint."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
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
    return artist


@pytest.fixture
async def test_track(db_session: AsyncSession, test_artist: Artist) -> Track:
    """create a test track with AT-URI."""
    track = Track(
        title="Test Track",
        artist_did=test_artist.did,
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
async def test_track_no_uri(db_session: AsyncSession, test_artist: Artist) -> Track:
    """create a test track without AT-URI."""
    track = Track(
        title="No URI Track",
        artist_did=test_artist.did,
        file_id="noatproto456",
        file_type="mp3",
        atproto_record_uri=None,
        atproto_record_cid=None,
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


async def test_get_track_by_uri_success(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
) -> None:
    """lookup existing track by AT-URI returns 200 with correct data."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/tracks/by-uri",
            params={"uri": test_track.atproto_record_uri},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == test_track.id
    assert data["title"] == "Test Track"
    assert data["atproto_record_uri"] == test_track.atproto_record_uri
    assert data["artist_handle"] == "artist.bsky.social"


async def test_get_track_by_uri_not_found(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """lookup non-existent URI returns 404."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/tracks/by-uri",
            params={"uri": "at://did:plc:nonexistent/fm.plyr.track/nope"},
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "track not found"


async def test_get_track_by_uri_null_uri_not_findable(
    test_app: FastAPI, db_session: AsyncSession, test_track_no_uri: Track
) -> None:
    """track with NULL atproto_record_uri is not findable via by-uri."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        # searching for empty string should not match NULL URIs
        response = await client.get(
            "/tracks/by-uri",
            params={"uri": ""},
        )

    assert response.status_code == 404


async def test_get_track_by_uri_matches_get_by_id(
    test_app: FastAPI, db_session: AsyncSession, test_track: Track
) -> None:
    """response shape from by-uri matches response from by-id for the same track."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        by_uri = await client.get(
            "/tracks/by-uri",
            params={"uri": test_track.atproto_record_uri},
        )
        by_id = await client.get(f"/tracks/{test_track.id}")

    assert by_uri.status_code == 200
    assert by_id.status_code == 200
    assert by_uri.json() == by_id.json()
