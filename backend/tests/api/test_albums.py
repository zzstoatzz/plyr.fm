"""tests for album API helpers."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend.api.albums import list_artist_albums
from backend.main import app
from backend.models import Album, Artist, Track


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:user123"):
        self.did = did
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked auth."""
    from backend._internal import require_auth

    async def mock_require_auth() -> Session:
        return MockSession()

    app.dependency_overrides[require_auth] = mock_require_auth

    yield app

    app.dependency_overrides.clear()


async def test_list_artist_albums_groups_tracks(db_session: AsyncSession):
    """albums listing groups tracks per slug and aggregates counts."""
    artist = Artist(
        did="did:plc:testartist",
        handle="artist.test",
        display_name="Artist Test",
        bio=None,
        avatar_url="https://example.com/avatar.jpg",
    )
    db_session.add(artist)
    await db_session.commit()

    # create albums first
    album_a = Album(
        artist_did=artist.did,
        slug="album-a",
        title="Album A",
        image_url="https://example.com/a.jpg",
    )
    album_b = Album(
        artist_did=artist.did,
        slug="album-b",
        title="Album B",
        image_url="https://example.com/b.jpg",
    )
    db_session.add_all([album_a, album_b])
    await db_session.flush()

    # create tracks linked to albums
    album_tracks = [
        Track(
            title="Song A1",
            file_id="file-a1",
            file_type="mp3",
            artist_did=artist.did,
            album_id=album_a.id,
            extra={"album": "Album A"},
            play_count=5,
        ),
        Track(
            title="Song A2",
            file_id="file-a2",
            file_type="mp3",
            artist_did=artist.did,
            album_id=album_a.id,
            extra={"album": "Album A"},
            play_count=3,
        ),
        Track(
            title="Song B1",
            file_id="file-b1",
            file_type="mp3",
            artist_did=artist.did,
            album_id=album_b.id,
            extra={"album": "Album B"},
            play_count=2,
        ),
    ]

    db_session.add_all(album_tracks)
    await db_session.commit()

    response = await list_artist_albums(artist.handle, db_session)
    albums = response["albums"]

    assert len(albums) == 2
    first = next(album for album in albums if album.slug == "album-a")
    assert first.track_count == 2
    assert first.total_plays == 8
    assert first.image_url == "https://example.com/a.jpg"

    second = next(album for album in albums if album.slug == "album-b")
    assert second.track_count == 1
    assert second.total_plays == 2


async def test_get_album_serializes_tracks_correctly(
    test_app: FastAPI, db_session: AsyncSession
):
    """test that get_album properly serializes tracks with album data."""
    # create artist
    artist = Artist(
        did="did:test:user123",
        handle="test.artist",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    # create album
    album = Album(
        artist_did=artist.did,
        slug="test-album",
        title="Test Album",
        image_url="https://example.com/album.jpg",
    )
    db_session.add(album)
    await db_session.flush()

    # create tracks linked to album
    track1 = Track(
        title="Track 1",
        file_id="test-file-1",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        play_count=5,
    )
    track2 = Track(
        title="Track 2",
        file_id="test-file-2",
        file_type="audio/mpeg",
        artist_did=artist.did,
        album_id=album.id,
        play_count=3,
    )
    db_session.add_all([track1, track2])
    await db_session.commit()

    # fetch album via API
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/albums/{artist.handle}/{album.slug}")

    assert response.status_code == 200
    data = response.json()

    # verify album metadata
    assert data["metadata"]["id"] == album.id
    assert data["metadata"]["title"] == "Test Album"
    assert data["metadata"]["slug"] == "test-album"
    assert data["metadata"]["artist"] == "Test Artist"
    assert data["metadata"]["artist_handle"] == "test.artist"
    assert data["metadata"]["track_count"] == 2
    assert data["metadata"]["total_plays"] == 8

    # verify tracks are properly serialized as dicts
    assert len(data["tracks"]) == 2
    assert isinstance(data["tracks"][0], dict)
    assert data["tracks"][0]["title"] == "Track 1"
    assert data["tracks"][0]["artist"] == "Test Artist"
    assert data["tracks"][0]["file_id"] == "test-file-1"
    assert data["tracks"][0]["play_count"] == 5

    # verify album data is included in tracks
    assert data["tracks"][0]["album"] is not None
    assert data["tracks"][0]["album"]["id"] == album.id
    assert data["tracks"][0]["album"]["slug"] == "test-album"
    assert data["tracks"][0]["album"]["title"] == "Test Album"
