"""tests for oEmbed endpoint."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.main import app
from backend.models import Album, Artist, Playlist, Track


@pytest.fixture
async def test_track(db_session: AsyncSession) -> Track:
    """create a test track for oEmbed testing."""
    artist = Artist(
        did="did:plc:oembed123",
        handle="test.artist.social",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="Test Track",
        artist_did=artist.did,
        file_id="oembed_test_123",
        file_type="mp3",
        r2_url="https://cdn.example.com/audio/test.mp3",
        image_url="https://cdn.example.com/images/cover.png",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    return track


@pytest.fixture
async def test_playlist(db_session: AsyncSession) -> Playlist:
    """create a test playlist for oEmbed testing."""
    artist = Artist(
        did="did:plc:oembed_pl",
        handle="playlist.owner.social",
        display_name="Playlist Owner",
    )
    db_session.add(artist)
    await db_session.flush()

    playlist = Playlist(
        name="Test Playlist",
        owner_did=artist.did,
        image_url="https://cdn.example.com/images/playlist.png",
        atproto_record_uri="at://did:plc:oembed_pl/fm.plyr.playlist/test",
        atproto_record_cid="bafytest",
    )
    db_session.add(playlist)
    await db_session.commit()
    await db_session.refresh(playlist)

    return playlist


@pytest.fixture
async def test_album(db_session: AsyncSession) -> Album:
    """create a test album for oEmbed testing."""
    artist = Artist(
        did="did:plc:oembed_al",
        handle="album.artist.social",
        display_name="Album Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    album = Album(
        title="Test Album",
        slug="test-album",
        artist_did=artist.did,
        image_url="https://cdn.example.com/images/album.png",
    )
    db_session.add(album)
    await db_session.commit()
    await db_session.refresh(album)

    return album


@pytest.fixture
def test_app(db_session: AsyncSession) -> FastAPI:
    """get test app with db session dependency to ensure correct database URL."""
    _ = db_session  # ensures database fixtures run first
    return app


async def test_oembed_returns_valid_response(
    test_app: FastAPI, test_track: Track
) -> None:
    """test that oEmbed returns proper response for valid track URL."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/oembed",
            params={"url": f"https://plyr.fm/track/{test_track.id}"},
        )

    assert response.status_code == 200
    data = response.json()

    assert data["version"] == "1.0"
    assert data["type"] == "rich"
    assert data["provider_name"] == "plyr.fm"
    assert "Test Track" in data["title"]
    assert "Test Artist" in data["title"]
    assert data["author_name"] == "Test Artist"
    assert f"/embed/track/{test_track.id}" in data["html"]
    assert "iframe" in data["html"]
    assert data["height"] == 165
    # should have thumbnail since track has image
    assert data["thumbnail_url"] == test_track.image_url


async def test_oembed_handles_encoded_url(test_app: FastAPI, test_track: Track) -> None:
    """test that oEmbed handles URL-encoded URLs."""
    import urllib.parse

    encoded_url = urllib.parse.quote(f"https://plyr.fm/track/{test_track.id}", safe="")

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/oembed", params={"url": encoded_url})

    assert response.status_code == 200
    data = response.json()
    assert f"/embed/track/{test_track.id}" in data["html"]


async def test_oembed_returns_404_for_invalid_url(test_app: FastAPI) -> None:
    """test that oEmbed returns 404 for unrecognized URLs."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/oembed", params={"url": "https://plyr.fm/not-a-thing"}
        )

    assert response.status_code == 404
    assert "unsupported URL format" in response.json()["detail"]


async def test_oembed_returns_404_for_nonexistent_track(test_app: FastAPI) -> None:
    """test that oEmbed returns 404 for track that doesn't exist."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/oembed", params={"url": "https://plyr.fm/track/99999"}
        )

    assert response.status_code == 404
    assert "track not found" in response.json()["detail"]


async def test_oembed_rejects_non_json_format(
    test_app: FastAPI, test_track: Track
) -> None:
    """test that oEmbed returns 501 for non-JSON format."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/oembed",
            params={
                "url": f"https://plyr.fm/track/{test_track.id}",
                "format": "xml",
            },
        )

    assert response.status_code == 501
    assert "only json format is supported" in response.json()["detail"]


async def test_oembed_respects_maxwidth(test_app: FastAPI, test_track: Track) -> None:
    """test that oEmbed respects maxwidth parameter."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/oembed",
            params={
                "url": f"https://plyr.fm/track/{test_track.id}",
                "maxwidth": 300,
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["width"] == 300


async def test_oembed_playlist_returns_valid_response(
    test_app: FastAPI, test_playlist: Playlist
) -> None:
    """test that oEmbed returns proper response for valid playlist URL."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/oembed",
            params={"url": f"https://plyr.fm/playlist/{test_playlist.id}"},
        )

    assert response.status_code == 200
    data = response.json()

    assert data["version"] == "1.0"
    assert data["type"] == "rich"
    assert "Test Playlist" in data["title"]
    assert "Playlist Owner" in data["title"]
    assert data["author_name"] == "Playlist Owner"
    assert f"/embed/playlist/{test_playlist.id}" in data["html"]
    assert "iframe" in data["html"]
    assert data["height"] == 380
    assert data["thumbnail_url"] == test_playlist.image_url


async def test_oembed_album_returns_valid_response(
    test_app: FastAPI, test_album: Album
) -> None:
    """test that oEmbed returns proper response for valid album URL."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/oembed",
            params={"url": "https://plyr.fm/u/album.artist.social/album/test-album"},
        )

    assert response.status_code == 200
    data = response.json()

    assert data["version"] == "1.0"
    assert data["type"] == "rich"
    assert "Test Album" in data["title"]
    assert "Album Artist" in data["title"]
    assert data["author_name"] == "Album Artist"
    assert "/embed/album/album.artist.social/test-album" in data["html"]
    assert "iframe" in data["html"]
    assert data["height"] == 380
    assert data["thumbnail_url"] == test_album.image_url


async def test_oembed_playlist_not_found(test_app: FastAPI) -> None:
    """test that oEmbed returns 404 for nonexistent playlist."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/oembed",
            params={
                "url": "https://plyr.fm/playlist/00000000-0000-0000-0000-000000000000"
            },
        )

    assert response.status_code == 404
    assert "playlist not found" in response.json()["detail"]


async def test_oembed_album_not_found(test_app: FastAPI) -> None:
    """test that oEmbed returns 404 for nonexistent album."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/oembed",
            params={"url": "https://plyr.fm/u/nobody/album/no-album"},
        )

    assert response.status_code == 404
    assert "album not found" in response.json()["detail"]


async def test_oembed_collection_respects_maxheight(
    test_app: FastAPI, test_playlist: Playlist
) -> None:
    """test that playlist/album oEmbed caps height at 600px."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/oembed",
            params={
                "url": f"https://plyr.fm/playlist/{test_playlist.id}",
                "maxheight": 9999,
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["height"] == 600
