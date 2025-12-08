"""tests for platform stats api endpoint."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Artist, Track


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    artist = Artist(
        did="did:plc:stats_test_artist",
        handle="stats-test.bsky.social",
        display_name="Stats Test Artist",
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


@pytest.fixture
async def tracks_with_duration(db_session: AsyncSession, artist: Artist) -> list[Track]:
    """create multiple test tracks with duration metadata."""
    tracks = [
        Track(
            title="Short Track",
            artist_did=artist.did,
            file_id="track1",
            file_type="mp3",
            extra={"duration": 180},  # 3 minutes
            play_count=10,
        ),
        Track(
            title="Long Track",
            artist_did=artist.did,
            file_id="track2",
            file_type="mp3",
            extra={"duration": 3600},  # 1 hour
            play_count=5,
        ),
        Track(
            title="Medium Track",
            artist_did=artist.did,
            file_id="track3",
            file_type="mp3",
            extra={"duration": 300},  # 5 minutes
            play_count=20,
        ),
    ]
    for track in tracks:
        db_session.add(track)
    await db_session.commit()
    return tracks


@pytest.fixture
async def track_without_duration(db_session: AsyncSession, artist: Artist) -> Track:
    """create a test track without duration (legacy upload)."""
    track = Track(
        title="No Duration Track",
        artist_did=artist.did,
        file_id="track_noduration",
        file_type="mp3",
        extra={},  # no duration
        play_count=3,
    )
    db_session.add(track)
    await db_session.commit()
    return track


async def test_get_stats_returns_total_duration(
    client: TestClient,
    tracks_with_duration: list[Track],
) -> None:
    """stats endpoint returns total duration in seconds."""
    response = client.get("/stats")
    assert response.status_code == 200

    data = response.json()
    assert "total_duration_seconds" in data

    # 180 + 3600 + 300 = 4080 seconds
    assert data["total_duration_seconds"] == 4080


async def test_get_stats_duration_ignores_null(
    client: TestClient,
    tracks_with_duration: list[Track],
    track_without_duration: Track,
) -> None:
    """stats endpoint handles tracks without duration gracefully."""
    response = client.get("/stats")
    assert response.status_code == 200

    data = response.json()
    # should still be 4080 (the track without duration doesn't add to total)
    assert data["total_duration_seconds"] == 4080
    # but track count should include all 4
    assert data["total_tracks"] == 4


async def test_get_stats_empty_database(client: TestClient) -> None:
    """stats endpoint returns zeros for empty database."""
    response = client.get("/stats")
    assert response.status_code == 200

    data = response.json()
    assert data["total_plays"] == 0
    assert data["total_tracks"] == 0
    assert data["total_artists"] == 0
    assert data["total_duration_seconds"] == 0


async def test_get_stats_aggregates_play_counts(
    client: TestClient,
    tracks_with_duration: list[Track],
) -> None:
    """stats endpoint correctly aggregates play counts."""
    response = client.get("/stats")
    assert response.status_code == 200

    data = response.json()
    # 10 + 5 + 20 = 35 total plays
    assert data["total_plays"] == 35


async def test_get_stats_counts_distinct_artists(
    client: TestClient,
    db_session: AsyncSession,
) -> None:
    """stats endpoint counts distinct artists correctly."""
    # create two artists
    artist1 = Artist(
        did="did:plc:artist1",
        handle="artist1.bsky.social",
        display_name="Artist 1",
    )
    artist2 = Artist(
        did="did:plc:artist2",
        handle="artist2.bsky.social",
        display_name="Artist 2",
    )
    db_session.add_all([artist1, artist2])
    await db_session.flush()

    # create tracks from both artists
    tracks = [
        Track(
            title="Track A1",
            artist_did=artist1.did,
            file_id="a1",
            file_type="mp3",
            extra={"duration": 100},
        ),
        Track(
            title="Track A2",
            artist_did=artist1.did,
            file_id="a2",
            file_type="mp3",
            extra={"duration": 100},
        ),
        Track(
            title="Track B1",
            artist_did=artist2.did,
            file_id="b1",
            file_type="mp3",
            extra={"duration": 100},
        ),
    ]
    for track in tracks:
        db_session.add(track)
    await db_session.commit()

    response = client.get("/stats")
    assert response.status_code == 200

    data = response.json()
    assert data["total_tracks"] == 3
    assert data["total_artists"] == 2
    assert data["total_duration_seconds"] == 300
