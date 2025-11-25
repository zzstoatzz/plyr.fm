"""tests for oEmbed endpoint."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.main import app
from backend.models import Artist, Track


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
def test_app() -> FastAPI:
    """get test app."""
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
    """test that oEmbed returns 404 for non-track URLs."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/oembed", params={"url": "https://plyr.fm/not-a-track"}
        )

    assert response.status_code == 404
    assert "invalid track URL" in response.json()["detail"]


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
