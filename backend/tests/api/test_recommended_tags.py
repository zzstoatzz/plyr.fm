"""tests for the recommended tags endpoint."""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.replicate_client import ClassificationResult, GenrePrediction
from backend.main import app
from backend.models import Artist, Tag, Track, TrackTag, get_db


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    artist = Artist(
        did="did:plc:recartist",
        handle="recartist.bsky.social",
        display_name="Rec Artist",
        pds_url="https://test.pds",
    )
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


@pytest.fixture
async def target_track(db_session: AsyncSession, artist: Artist) -> Track:
    """create the track we want recommendations for."""
    track = Track(
        title="Target Track",
        artist_did=artist.did,
        file_id="target001",
        file_type="mp3",
        r2_url="https://mock.r2.dev/audio/target001.mp3",
        extra={"duration": 200},
        atproto_record_uri="at://did:plc:recartist/fm.plyr.track/target001",
        atproto_record_cid="bafytarget001",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    return track


@pytest.fixture
async def target_track_with_predictions(
    db_session: AsyncSession, artist: Artist
) -> Track:
    """create a track with stored genre predictions."""
    track = Track(
        title="Classified Track",
        artist_did=artist.did,
        file_id="classified001",
        file_type="mp3",
        r2_url="https://mock.r2.dev/audio/classified001.mp3",
        extra={
            "duration": 200,
            "genre_predictions": [
                {"name": "Techno", "confidence": 0.87},
                {"name": "Electronic", "confidence": 0.72},
                {"name": "House", "confidence": 0.55},
                {"name": "Ambient", "confidence": 0.31},
            ],
        },
        atproto_record_uri="at://did:plc:recartist/fm.plyr.track/classified001",
        atproto_record_cid="bafyclassified001",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    return track


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked db."""

    async def mock_get_db():
        yield db_session

    app.dependency_overrides[get_db] = mock_get_db
    yield app
    app.dependency_overrides.clear()


async def test_recommended_tags_returns_stored_predictions(
    test_app: FastAPI,
    target_track_with_predictions: Track,
):
    """test that stored genre predictions are returned."""
    with patch("backend.config.settings.replicate") as mock_replicate:
        mock_replicate.enabled = True

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                f"/tracks/{target_track_with_predictions.id}/recommended-tags?limit=5"
            )

    assert response.status_code == 200
    data = response.json()
    assert data["track_id"] == target_track_with_predictions.id
    assert data["available"] is True
    assert len(data["tags"]) == 4

    # should be in confidence order
    assert data["tags"][0]["name"] == "Techno"
    assert data["tags"][0]["score"] == 0.87
    assert data["tags"][1]["name"] == "Electronic"


async def test_recommended_tags_on_demand_classification(
    test_app: FastAPI,
    target_track: Track,
):
    """test that on-demand classification happens when no predictions stored."""
    mock_result = ClassificationResult(
        success=True,
        genres=[
            GenrePrediction(name="Drum and Bass", confidence=0.91),
            GenrePrediction(name="Electronic", confidence=0.65),
        ],
    )

    with (
        patch("backend.config.settings.replicate") as mock_replicate,
        patch(
            "backend._internal.replicate_client.get_replicate_client"
        ) as mock_get_client,
    ):
        mock_replicate.enabled = True
        mock_client = AsyncMock()
        mock_client.classify = AsyncMock(return_value=mock_result)
        mock_get_client.return_value = mock_client

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(f"/tracks/{target_track.id}/recommended-tags")

    assert response.status_code == 200
    data = response.json()
    assert data["track_id"] == target_track.id
    assert data["available"] is True
    assert len(data["tags"]) == 2
    assert data["tags"][0]["name"] == "Drum and Bass"
    assert data["tags"][0]["score"] == 0.91

    # verify classify was called with the track's R2 URL
    mock_client.classify.assert_called_once_with(target_track.r2_url)


async def test_recommended_tags_excludes_existing_tags(
    test_app: FastAPI,
    db_session: AsyncSession,
    target_track_with_predictions: Track,
    artist: Artist,
):
    """test that tags the track already has are excluded from recommendations."""
    # create a tag matching one of the predictions
    techno_tag = Tag(name="techno", created_by_did=artist.did)
    db_session.add(techno_tag)
    await db_session.flush()

    db_session.add(
        TrackTag(track_id=target_track_with_predictions.id, tag_id=techno_tag.id)
    )
    await db_session.commit()

    with patch("backend.config.settings.replicate") as mock_replicate:
        mock_replicate.enabled = True

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                f"/tracks/{target_track_with_predictions.id}/recommended-tags"
            )

    assert response.status_code == 200
    data = response.json()
    tag_names = [t["name"] for t in data["tags"]]
    # "Techno" matches "techno" tag (case-insensitive) — should be excluded
    assert "Techno" not in tag_names
    # other predictions should still be present
    assert "Electronic" in tag_names
    assert "House" in tag_names


async def test_recommended_tags_nonexistent_track(test_app: FastAPI):
    """test that 404 is returned for a nonexistent track."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/tracks/999999/recommended-tags")

    assert response.status_code == 404


async def test_recommended_tags_replicate_disabled(
    test_app: FastAPI,
    target_track: Track,
):
    """test that available=false is returned when replicate is disabled."""
    with patch("backend.config.settings.replicate") as mock_replicate:
        mock_replicate.enabled = False

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(f"/tracks/{target_track.id}/recommended-tags")

    assert response.status_code == 200
    data = response.json()
    assert data["available"] is False
    assert data["tags"] == []
