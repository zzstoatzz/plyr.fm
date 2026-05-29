"""tests for public radio state."""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.main import app
from backend.models import Artist, Tag, Track, TrackLike, TrackTag, get_db


@pytest.fixture
def radio_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """test app using the test db session."""

    async def mock_get_db() -> AsyncSession:  # type: ignore[misc]
        yield db_session

    app.dependency_overrides[get_db] = mock_get_db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def radio_artist(db_session: AsyncSession) -> Artist:
    """create a radio test artist."""
    artist = Artist(
        did="did:plc:radio",
        handle="radio.plyr.fm",
        display_name="Radio Artist",
        avatar_url="https://images.example/avatar.jpg",
    )
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


async def _create_track(
    db_session: AsyncSession,
    artist: Artist,
    *,
    title: str,
    file_id: str,
    created_at: datetime,
    play_count: int = 0,
    unlisted: bool = False,
    support_gate: dict | None = None,
) -> Track:
    """Create a track for radio tests."""
    track = Track(
        title=title,
        artist_did=artist.did,
        file_id=file_id,
        file_type="mp3",
        created_at=created_at,
        extra={"duration": 123},
        image_url="https://images.example/cover.jpg",
        atproto_record_uri=f"at://{artist.did}/fm.plyr.track/{file_id}",
        play_count=play_count,
        unlisted=unlisted,
        support_gate=support_gate,
    )
    db_session.add(track)
    await db_session.flush()
    return track


async def test_radio_state_returns_live_public_rotation(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """radio state returns one live station with public tracks only."""
    now = datetime.now(UTC)
    visible = await _create_track(
        db_session,
        radio_artist,
        title="Visible",
        file_id="visible",
        created_at=now,
    )
    await _create_track(
        db_session,
        radio_artist,
        title="Unlisted",
        file_id="unlisted",
        created_at=now - timedelta(minutes=1),
        unlisted=True,
    )
    await _create_track(
        db_session,
        radio_artist,
        title="Gated",
        file_id="gated",
        created_at=now - timedelta(minutes=2),
        support_gate={"type": "any"},
    )
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        response = await client.get("/radio/state")

    assert response.status_code == 200
    data = response.json()
    assert data["station"] == "plyr.fm radio"
    assert data["current"]["title"] == "Visible"
    assert data["current"]["stream_url"] == (
        f"https://radio.plyr.fm/audio/{visible.file_id}"
    )
    assert data["current"]["duration"] == 123
    assert data["current"]["artwork_url"] == "https://images.example/cover.jpg"
    assert [track["title"] for track in data["rotation"]] == ["Visible"]


async def test_radio_state_orders_rotation_by_likes_then_plays(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """likes and play counts determine what gets into the radio loop."""
    now = datetime.now(UTC)
    played = await _create_track(
        db_session,
        radio_artist,
        title="Played",
        file_id="played",
        created_at=now,
        play_count=50,
    )
    liked = await _create_track(
        db_session,
        radio_artist,
        title="Liked",
        file_id="liked",
        created_at=now - timedelta(minutes=1),
        play_count=1,
    )
    latest = await _create_track(
        db_session,
        radio_artist,
        title="Latest",
        file_id="latest",
        created_at=now - timedelta(minutes=2),
    )

    for index in range(2):
        db_session.add(
            TrackLike(
                track_id=liked.id,
                user_did=f"did:test:liker{index}",
                atproto_like_uri=f"at://did:test:liker{index}/fm.plyr.like/liked",
            )
        )
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        response = await client.get("/radio/state.json")

    assert response.status_code == 200
    rotation = response.json()["rotation"]
    assert [track["title"] for track in rotation] == ["Liked", "Played", "Latest"]
    assert rotation[0]["like_count"] == 2
    assert rotation[1]["play_count"] == played.play_count
    assert rotation[2]["id"] == latest.id


async def test_radio_state_includes_tags_and_up_next(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """radio state includes useful metadata for clients."""
    now = datetime.now(UTC)
    first = await _create_track(
        db_session,
        radio_artist,
        title="First",
        file_id="first",
        created_at=now,
    )
    second = await _create_track(
        db_session,
        radio_artist,
        title="Second",
        file_id="second",
        created_at=now - timedelta(minutes=1),
    )
    tag = Tag(name="desert", created_by_did=radio_artist.did)
    db_session.add(tag)
    await db_session.flush()
    db_session.add(TrackTag(track_id=first.id, tag_id=tag.id))
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        response = await client.get("/radio/state.json")

    assert response.status_code == 200
    data = response.json()
    assert data["loop_duration_seconds"] == 246
    assert data["progress_seconds"] >= 0
    assert data["current_started_at"] is not None
    assert data["current_ends_at"] is not None
    assert data["rotation"][0]["tags"] == ["desert"]
    assert data["up_next"]
    assert {track["id"] for track in data["up_next"]}.issubset({first.id, second.id})
