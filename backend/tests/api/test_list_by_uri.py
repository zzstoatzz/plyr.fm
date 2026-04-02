"""tests for generic list resolver endpoint (GET /lists/by-uri)."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.main import app
from backend.models import Album, Artist, Playlist

ALBUM_URI = "at://did:plc:artist123/fm.plyr.list/album456"
PLAYLIST_URI = "at://did:plc:artist123/fm.plyr.list/playlist789"


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
async def test_album(db_session: AsyncSession, test_artist: Artist) -> Album:
    """create a test album."""
    album = Album(
        artist_did=test_artist.did,
        title="Test Album",
        slug="test-album",
        atproto_record_uri=ALBUM_URI,
        atproto_record_cid="bafyalbum456",
    )
    db_session.add(album)
    await db_session.commit()
    await db_session.refresh(album)
    return album


@pytest.fixture
async def test_playlist(db_session: AsyncSession, test_artist: Artist) -> Playlist:
    """create a test playlist."""
    playlist = Playlist(
        owner_did=test_artist.did,
        name="Test Playlist",
        atproto_record_uri=PLAYLIST_URI,
        atproto_record_cid="bafyplaylist789",
        track_count=0,
    )
    db_session.add(playlist)
    await db_session.commit()
    await db_session.refresh(playlist)
    return playlist


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked auth."""

    async def mock_require_auth() -> Session:
        return MockSession()

    app.dependency_overrides[require_auth] = mock_require_auth
    yield app
    app.dependency_overrides.clear()


async def test_resolve_album_uri(
    test_app: FastAPI, db_session: AsyncSession, test_album: Album
) -> None:
    """album AT-URI returns type=album with handle and slug."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/lists/by-uri", params={"uri": ALBUM_URI})

    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "album"
    assert data["id"] == test_album.id
    assert data["handle"] == "artist.bsky.social"
    assert data["slug"] == "test-album"


async def test_resolve_playlist_uri(
    test_app: FastAPI, db_session: AsyncSession, test_playlist: Playlist
) -> None:
    """playlist AT-URI returns type=playlist with id."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/lists/by-uri", params={"uri": PLAYLIST_URI})

    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "playlist"
    assert data["id"] == test_playlist.id


async def test_resolve_unknown_uri(test_app: FastAPI, db_session: AsyncSession) -> None:
    """unknown AT-URI returns 404."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/lists/by-uri",
            params={"uri": "at://did:plc:nobody/fm.plyr.list/nope"},
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "list not found"
