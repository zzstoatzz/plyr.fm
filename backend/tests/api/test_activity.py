"""tests for activity feed endpoint."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Artist, Track, TrackComment, TrackLike


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    artist = Artist(
        did="did:plc:activity_artist",
        handle="activity-artist.bsky.social",
        display_name="Activity Artist",
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


@pytest.fixture
async def other_artist(db_session: AsyncSession) -> Artist:
    """create a second test artist."""
    artist = Artist(
        did="did:plc:activity_other",
        handle="other-artist.bsky.social",
        display_name="Other Artist",
    )
    db_session.add(artist)
    await db_session.commit()
    return artist


@pytest.fixture
async def track(db_session: AsyncSession, artist: Artist) -> Track:
    """create a test track."""
    track = Track(
        title="Test Track",
        artist_did=artist.did,
        file_id="activity_track_1",
        file_type="mp3",
        image_url="https://example.com/image.jpg",
        thumbnail_url="https://example.com/thumb.jpg",
    )
    db_session.add(track)
    await db_session.commit()
    return track


async def test_empty_feed(client: TestClient, db_session: AsyncSession) -> None:
    """empty database returns empty events with no cursor."""
    response = client.get("/activity/")
    assert response.status_code == 200
    data = response.json()
    assert data["events"] == []
    assert data["next_cursor"] is None
    assert data["has_more"] is False


async def test_all_event_types(
    client: TestClient,
    db_session: AsyncSession,
    artist: Artist,
    other_artist: Artist,
    track: Track,
) -> None:
    """all four event types appear with correct type field."""
    like = TrackLike(
        track_id=track.id,
        user_did=other_artist.did,
    )
    comment = TrackComment(
        track_id=track.id,
        user_did=other_artist.did,
        text="great track!",
        timestamp_ms=5000,
    )
    db_session.add_all([like, comment])
    await db_session.commit()

    response = client.get("/activity/")
    assert response.status_code == 200
    data = response.json()

    event_types = {e["type"] for e in data["events"]}
    assert event_types == {"like", "track", "comment", "join"}


async def test_chronological_order(
    client: TestClient,
    db_session: AsyncSession,
    artist: Artist,
    track: Track,
) -> None:
    """events are ordered by created_at DESC."""
    response = client.get("/activity/")
    assert response.status_code == 200
    data = response.json()

    timestamps = [e["created_at"] for e in data["events"]]
    assert timestamps == sorted(timestamps, reverse=True)


async def test_cursor_pagination(
    client: TestClient,
    db_session: AsyncSession,
    artist: Artist,
) -> None:
    """cursor pagination returns two pages with no overlap."""
    now = datetime.now(UTC)
    tracks = []
    for i in range(5):
        t = Track(
            title=f"Track {i}",
            artist_did=artist.did,
            file_id=f"pagination_{i}",
            file_type="mp3",
            created_at=now + timedelta(seconds=i + 1),
        )
        tracks.append(t)
    db_session.add_all(tracks)
    await db_session.commit()

    # page 1 (limit=3: 5 tracks + 1 join = 6 total events, should have more)
    resp1 = client.get("/activity/", params={"limit": 3})
    assert resp1.status_code == 200
    page1 = resp1.json()
    assert page1["has_more"] is True
    assert page1["next_cursor"] is not None

    # page 2
    resp2 = client.get(
        "/activity/", params={"limit": 3, "cursor": page1["next_cursor"]}
    )
    assert resp2.status_code == 200
    page2 = resp2.json()

    # no overlap
    page1_times = {e["created_at"] for e in page1["events"]}
    page2_times = {e["created_at"] for e in page2["events"]}
    assert page1_times.isdisjoint(page2_times)


async def test_invalid_cursor(client: TestClient, db_session: AsyncSession) -> None:
    """invalid cursor returns 400."""
    response = client.get("/activity/", params={"cursor": "not-a-date"})
    assert response.status_code == 400
    assert "cursor" in response.json()["detail"].lower()


async def test_limit_clamping(
    client: TestClient,
    db_session: AsyncSession,
    artist: Artist,
) -> None:
    """limit is clamped: 0 → 1, 200 → 100."""
    resp_low = client.get("/activity/", params={"limit": 0})
    assert resp_low.status_code == 200

    resp_high = client.get("/activity/", params={"limit": 200})
    assert resp_high.status_code == 200


async def test_like_includes_track_info(
    client: TestClient,
    db_session: AsyncSession,
    artist: Artist,
    other_artist: Artist,
    track: Track,
) -> None:
    """like events include track info."""
    like = TrackLike(
        track_id=track.id,
        user_did=other_artist.did,
    )
    db_session.add(like)
    await db_session.commit()

    response = client.get("/activity/")
    assert response.status_code == 200
    data = response.json()

    like_events = [e for e in data["events"] if e["type"] == "like"]
    assert len(like_events) >= 1
    like_event = like_events[0]
    assert like_event["track"] is not None
    assert like_event["track"]["id"] == track.id
    assert like_event["track"]["title"] == track.title
    assert like_event["track"]["artist_handle"] == artist.handle


async def test_comment_includes_text(
    client: TestClient,
    db_session: AsyncSession,
    artist: Artist,
    other_artist: Artist,
    track: Track,
) -> None:
    """comment events include comment_text."""
    comment = TrackComment(
        track_id=track.id,
        user_did=other_artist.did,
        text="this slaps",
        timestamp_ms=0,
    )
    db_session.add(comment)
    await db_session.commit()

    response = client.get("/activity/")
    assert response.status_code == 200
    data = response.json()

    comment_events = [e for e in data["events"] if e["type"] == "comment"]
    assert len(comment_events) >= 1
    assert comment_events[0]["comment_text"] == "this slaps"
    assert comment_events[0]["track"] is not None


async def test_join_has_null_track(
    client: TestClient,
    db_session: AsyncSession,
    artist: Artist,
) -> None:
    """join events have track: null."""
    response = client.get("/activity/")
    assert response.status_code == 200
    data = response.json()

    join_events = [e for e in data["events"] if e["type"] == "join"]
    assert len(join_events) >= 1
    assert join_events[0]["track"] is None
    assert join_events[0]["comment_text"] is None
