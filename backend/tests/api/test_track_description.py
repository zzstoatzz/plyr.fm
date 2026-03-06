"""tests for track description field."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Artist, Track


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    artist = Artist(
        did="did:plc:desc_test_artist",
        handle="desc-test.bsky.social",
        display_name="Description Test Artist",
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


@pytest.fixture
async def track_with_description(db_session: AsyncSession, artist: Artist) -> Track:
    """create a track with a description."""
    track = Track(
        title="Described Track",
        artist_did=artist.did,
        file_id="desc_track1",
        file_type="mp3",
        description="these are the liner notes for the track",
    )
    db_session.add(track)
    await db_session.commit()
    return track


@pytest.fixture
async def track_without_description(db_session: AsyncSession, artist: Artist) -> Track:
    """create a track without a description."""
    track = Track(
        title="Plain Track",
        artist_did=artist.did,
        file_id="desc_track2",
        file_type="mp3",
    )
    db_session.add(track)
    await db_session.commit()
    return track


async def test_description_column_nullable(
    db_session: AsyncSession, artist: Artist
) -> None:
    """description column accepts null values."""
    track = Track(
        title="No Desc",
        artist_did=artist.did,
        file_id="desc_null_test",
        file_type="mp3",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    assert track.description is None


async def test_description_stored_and_retrieved(
    db_session: AsyncSession, track_with_description: Track
) -> None:
    """description is persisted and can be read back."""
    result = await db_session.execute(
        select(Track).where(Track.id == track_with_description.id)
    )
    track = result.scalar_one()
    assert track.description == "these are the liner notes for the track"


async def test_description_in_track_listing(
    client: TestClient,
    track_with_description: Track,
    track_without_description: Track,
) -> None:
    """track listing includes description field."""
    response = client.get("/tracks/")
    assert response.status_code == 200
    data = response.json()
    tracks = data["tracks"]

    described = next(t for t in tracks if t["id"] == track_with_description.id)
    assert described["description"] == "these are the liner notes for the track"

    plain = next(t for t in tracks if t["id"] == track_without_description.id)
    assert plain["description"] is None
