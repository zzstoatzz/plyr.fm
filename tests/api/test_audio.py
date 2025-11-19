"""tests for audio streaming endpoint."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.main import app
from backend.models import Artist, Track


@pytest.fixture
async def test_track_with_r2_url(db_session: AsyncSession) -> Track:
    """create a test track with r2_url."""
    artist = Artist(
        did="did:plc:artist123",
        handle="artist.bsky.social",
        display_name="Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="Test Track",
        artist_did=artist.did,
        file_id="test123",
        file_type="mp3",
        r2_url="https://cdn.example.com/audio/test123.mp3",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    return track


@pytest.fixture
async def test_track_without_r2_url(db_session: AsyncSession) -> Track:
    """create a test track without r2_url (needs lookup)."""
    artist = Artist(
        did="did:plc:artist456",
        handle="artist2.bsky.social",
        display_name="Test Artist 2",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="Test Track 2",
        artist_did=artist.did,
        file_id="test456",
        file_type="flac",
        r2_url=None,  # no cached URL
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    return track


@pytest.fixture
def test_app() -> FastAPI:
    """get test app."""
    return app


async def test_stream_audio_with_cached_url(
    test_app: FastAPI, test_track_with_r2_url: Track
):
    """test that storage uses cached r2_url directly (zero HEADs)."""
    # create mock storage
    mock_storage = MagicMock()
    mock_storage.get_url = AsyncMock()

    with patch("backend.api.audio.storage", mock_storage):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                f"/audio/{test_track_with_r2_url.file_id}", follow_redirects=False
            )

    assert response.status_code == 307
    assert response.headers["location"] == test_track_with_r2_url.r2_url
    # should NOT call get_url when r2_url is cached
    mock_storage.get_url.assert_not_called()


async def test_stream_audio_without_cached_url(
    test_app: FastAPI, test_track_without_r2_url: Track
):
    """test that storage calls get_url with extension when r2_url is None."""
    expected_url = "https://cdn.example.com/audio/test456.flac"

    # create mock storage
    mock_storage = MagicMock()
    mock_storage.get_url = AsyncMock(return_value=expected_url)

    with patch("backend.api.audio.storage", mock_storage):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                f"/audio/{test_track_without_r2_url.file_id}", follow_redirects=False
            )

        # verify get_url was called with the correct extension
        mock_storage.get_url.assert_called_once_with(
            test_track_without_r2_url.file_id,
            file_type="audio",
            extension=test_track_without_r2_url.file_type,
        )

    assert response.status_code == 307
    assert response.headers["location"] == expected_url


async def test_stream_audio_track_not_found(test_app: FastAPI):
    """test that endpoint returns 404 when track doesn't exist in DB."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/audio/nonexistent", follow_redirects=False)

    assert response.status_code == 404
    assert response.json()["detail"] == "audio file not found"


async def test_stream_audio_file_not_in_storage(
    test_app: FastAPI, test_track_without_r2_url: Track
):
    """test that endpoint returns 404 when get_url returns None."""
    mock_storage = MagicMock()
    mock_storage.get_url = AsyncMock(return_value=None)

    with patch("backend.api.audio.storage", mock_storage):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                f"/audio/{test_track_without_r2_url.file_id}", follow_redirects=False
            )

    assert response.status_code == 404
    assert response.json()["detail"] == "audio file not found"
