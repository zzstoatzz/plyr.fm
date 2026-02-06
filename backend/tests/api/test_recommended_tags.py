"""tests for the recommended tags endpoint."""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.tpuf_client import VectorSearchResult
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
        extra={"duration": 200},
        atproto_record_uri="at://did:plc:recartist/fm.plyr.track/target001",
        atproto_record_cid="bafytarget001",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    return track


@pytest.fixture
async def similar_tracks_with_tags(
    db_session: AsyncSession, artist: Artist
) -> tuple[list[Track], list[Tag]]:
    """create similar tracks with various tags."""
    # create tags
    ambient_tag = Tag(name="ambient", created_by_did=artist.did)
    chill_tag = Tag(name="chill", created_by_did=artist.did)
    electronic_tag = Tag(name="electronic", created_by_did=artist.did)
    db_session.add_all([ambient_tag, chill_tag, electronic_tag])
    await db_session.flush()

    tracks = []
    for i in range(3):
        track = Track(
            title=f"Similar Track {i}",
            artist_did=artist.did,
            file_id=f"similar{i:03d}",
            file_type="mp3",
            extra={"duration": 180},
            atproto_record_uri=f"at://did:plc:recartist/fm.plyr.track/similar{i:03d}",
            atproto_record_cid=f"bafysimilar{i:03d}",
        )
        db_session.add(track)
        tracks.append(track)

    await db_session.flush()

    # track 0: ambient, chill (most similar — will get highest similarity)
    db_session.add(TrackTag(track_id=tracks[0].id, tag_id=ambient_tag.id))
    db_session.add(TrackTag(track_id=tracks[0].id, tag_id=chill_tag.id))
    # track 1: ambient, electronic
    db_session.add(TrackTag(track_id=tracks[1].id, tag_id=ambient_tag.id))
    db_session.add(TrackTag(track_id=tracks[1].id, tag_id=electronic_tag.id))
    # track 2: chill
    db_session.add(TrackTag(track_id=tracks[2].id, tag_id=chill_tag.id))

    await db_session.commit()
    for t in tracks:
        await db_session.refresh(t)

    return tracks, [ambient_tag, chill_tag, electronic_tag]


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked db."""

    async def mock_get_db():
        yield db_session

    app.dependency_overrides[get_db] = mock_get_db
    yield app
    app.dependency_overrides.clear()


async def test_recommended_tags_returns_ranked_tags(
    test_app: FastAPI,
    target_track: Track,
    similar_tracks_with_tags: tuple[list[Track], list[Tag]],
):
    """test that recommended tags are returned ranked by similarity-weighted score."""
    similar_tracks, _ = similar_tracks_with_tags

    mock_embedding = [0.1] * 512
    mock_similar = [
        VectorSearchResult(track_id=similar_tracks[0].id, distance=0.1),  # sim=0.9
        VectorSearchResult(track_id=similar_tracks[1].id, distance=0.3),  # sim=0.7
        VectorSearchResult(track_id=similar_tracks[2].id, distance=0.5),  # sim=0.5
    ]

    with (
        patch("backend.config.settings.modal") as mock_modal,
        patch("backend.config.settings.turbopuffer") as mock_tpuf,
        patch("backend.api.tracks.tags.tpuf_client") as mock_client,
    ):
        mock_modal.enabled = True
        mock_tpuf.enabled = True
        mock_client.get_vector = AsyncMock(return_value=mock_embedding)
        mock_client.query = AsyncMock(return_value=mock_similar)

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(
                f"/tracks/{target_track.id}/recommended-tags?limit=5"
            )

    assert response.status_code == 200
    data = response.json()
    assert data["track_id"] == target_track.id
    assert data["available"] is True
    assert len(data["tags"]) > 0

    tag_names = [t["name"] for t in data["tags"]]
    # ambient appears in tracks 0 (sim=0.9) and 1 (sim=0.7) -> score=1.6
    # chill appears in tracks 0 (sim=0.9) and 2 (sim=0.5) -> score=1.4
    # electronic appears in track 1 (sim=0.7) -> score=0.7
    assert tag_names[0] == "ambient"
    assert tag_names[1] == "chill"
    assert tag_names[2] == "electronic"

    # scores should be normalized to 0-1
    for tag in data["tags"]:
        assert 0 <= tag["score"] <= 1


async def test_recommended_tags_excludes_existing_tags(
    test_app: FastAPI,
    db_session: AsyncSession,
    target_track: Track,
    similar_tracks_with_tags: tuple[list[Track], list[Tag]],
):
    """test that tags the track already has are excluded from recommendations."""
    similar_tracks, tags = similar_tracks_with_tags
    ambient_tag = tags[0]

    # tag the target track with "ambient"
    db_session.add(TrackTag(track_id=target_track.id, tag_id=ambient_tag.id))
    await db_session.commit()

    mock_embedding = [0.1] * 512
    mock_similar = [
        VectorSearchResult(track_id=similar_tracks[0].id, distance=0.1),
        VectorSearchResult(track_id=similar_tracks[1].id, distance=0.3),
        VectorSearchResult(track_id=similar_tracks[2].id, distance=0.5),
    ]

    with (
        patch("backend.config.settings.modal") as mock_modal,
        patch("backend.config.settings.turbopuffer") as mock_tpuf,
        patch("backend.api.tracks.tags.tpuf_client") as mock_client,
    ):
        mock_modal.enabled = True
        mock_tpuf.enabled = True
        mock_client.get_vector = AsyncMock(return_value=mock_embedding)
        mock_client.query = AsyncMock(return_value=mock_similar)

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(f"/tracks/{target_track.id}/recommended-tags")

    assert response.status_code == 200
    data = response.json()
    tag_names = [t["name"] for t in data["tags"]]
    assert "ambient" not in tag_names
    # chill and electronic should still be recommended
    assert "chill" in tag_names
    assert "electronic" in tag_names


async def test_recommended_tags_nonexistent_track(test_app: FastAPI):
    """test that 404 is returned for a nonexistent track."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/tracks/999999/recommended-tags")

    assert response.status_code == 404


async def test_recommended_tags_embeddings_disabled(
    test_app: FastAPI,
    target_track: Track,
):
    """test that available=false is returned when embeddings are disabled."""
    with (
        patch("backend.config.settings.modal") as mock_modal,
        patch("backend.config.settings.turbopuffer") as mock_tpuf,
    ):
        mock_modal.enabled = False
        mock_tpuf.enabled = True

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(f"/tracks/{target_track.id}/recommended-tags")

    assert response.status_code == 200
    data = response.json()
    assert data["available"] is False
    assert data["tags"] == []


async def test_recommended_tags_no_embedding(
    test_app: FastAPI,
    target_track: Track,
):
    """test that empty tags are returned when track has no embedding."""
    with (
        patch("backend.config.settings.modal") as mock_modal,
        patch("backend.config.settings.turbopuffer") as mock_tpuf,
        patch("backend.api.tracks.tags.tpuf_client") as mock_client,
    ):
        mock_modal.enabled = True
        mock_tpuf.enabled = True
        mock_client.get_vector = AsyncMock(return_value=None)

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(f"/tracks/{target_track.id}/recommended-tags")

    assert response.status_code == 200
    data = response.json()
    assert data["available"] is True
    assert data["tags"] == []


async def test_recommended_tags_filters_self_from_results(
    test_app: FastAPI,
    target_track: Track,
    similar_tracks_with_tags: tuple[list[Track], list[Tag]],
):
    """test that the target track is excluded from its own similar results."""
    similar_tracks, _ = similar_tracks_with_tags

    mock_embedding = [0.1] * 512
    # include the target track in results (distance=0, most similar to itself)
    mock_similar = [
        VectorSearchResult(track_id=target_track.id, distance=0.0),
        VectorSearchResult(track_id=similar_tracks[0].id, distance=0.2),
    ]

    with (
        patch("backend.config.settings.modal") as mock_modal,
        patch("backend.config.settings.turbopuffer") as mock_tpuf,
        patch("backend.api.tracks.tags.tpuf_client") as mock_client,
    ):
        mock_modal.enabled = True
        mock_tpuf.enabled = True
        mock_client.get_vector = AsyncMock(return_value=mock_embedding)
        mock_client.query = AsyncMock(return_value=mock_similar)

        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.get(f"/tracks/{target_track.id}/recommended-tags")

    assert response.status_code == 200
    data = response.json()
    # should still return tags from the neighbor, not crash
    assert data["track_id"] == target_track.id
    assert len(data["tags"]) > 0
