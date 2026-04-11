"""tests for playlist lookup by AT-URI endpoint."""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.atproto.records import RecordNotFound
from backend.main import app
from backend.models import Artist, Playlist


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


PLAYLIST_URI = "at://did:plc:artist123/fm.plyr.list/playlist123"


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
async def test_playlist(db_session: AsyncSession, test_artist: Artist) -> Playlist:
    """create a test playlist."""
    playlist = Playlist(
        owner_did=test_artist.did,
        name="Test Playlist",
        atproto_record_uri=PLAYLIST_URI,
        atproto_record_cid="bafyplaylist123",
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


async def test_get_playlist_by_uri_success(
    test_app: FastAPI, db_session: AsyncSession, test_playlist: Playlist
) -> None:
    """lookup existing playlist by AT-URI returns 200."""
    with patch(
        "backend.api.lists.playlists.fetch_list_item_uris",
        new_callable=AsyncMock,
        return_value=[],
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                "/lists/playlists/by-uri",
                params={"uri": PLAYLIST_URI},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == test_playlist.id
    assert data["name"] == "Test Playlist"
    assert data["atproto_record_uri"] == PLAYLIST_URI
    assert data["tracks"] == []


async def test_get_playlist_by_uri_not_found(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """lookup non-existent playlist URI returns 404."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/lists/playlists/by-uri",
            params={"uri": "at://did:plc:nonexistent/fm.plyr.list/nope"},
        )

    assert response.status_code == 404
    assert response.json()["detail"] == "playlist not found"


async def test_get_playlist_by_uri_pds_record_not_found(
    test_app: FastAPI, db_session: AsyncSession, test_playlist: Playlist
) -> None:
    """playlist exists in DB but PDS record is gone — returns 404 not 500."""
    with patch(
        "backend.api.lists.playlists.fetch_list_item_uris",
        new_callable=AsyncMock,
        side_effect=RecordNotFound("record not found"),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                "/lists/playlists/by-uri",
                params={"uri": PLAYLIST_URI},
            )

    assert response.status_code == 404
    assert "not found on PDS" in response.json()["detail"]


async def test_get_playlist_by_id_pds_record_not_found(
    test_app: FastAPI, db_session: AsyncSession, test_playlist: Playlist
) -> None:
    """playlist exists in DB but PDS record is gone — returns 404 not 500."""
    with patch(
        "backend.api.lists.playlists.fetch_list_item_uris",
        new_callable=AsyncMock,
        side_effect=RecordNotFound("record not found"),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                f"/lists/playlists/{test_playlist.id}",
            )

    assert response.status_code == 404
    assert "not found on PDS" in response.json()["detail"]
