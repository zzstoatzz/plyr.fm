"""tests for public radio state and the station lineup."""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.radio import lenses
from backend.api.radio.lenses import LensContext
from backend.main import app
from backend.models import Artist, Tag, Track, TrackLike, TrackTag, get_db

# clear_database only removes timestamped rows created after test start.
TEST_TIME_OFFSET = timedelta(minutes=10)


# --- lens semantics (pure functions, no sampler randomness) -----------------


def _lens_track(track_id: int, *, play_count: int, created_at: datetime) -> Track:
    return Track(id=track_id, play_count=play_count, created_at=created_at)


def _ctx(
    *, like_counts: dict[int, int], now: datetime, order: list[int]
) -> LensContext:
    """LensContext with `order` listed newest-first (0-based recency rank)."""
    return LensContext(
        like_counts=like_counts,
        now=now,
        recency_rank={track_id: rank for rank, track_id in enumerate(order)},
    )


def test_loved_lens_prefers_liked() -> None:
    now = datetime.now(UTC)
    liked = _lens_track(1, play_count=0, created_at=now)
    unliked = _lens_track(2, play_count=0, created_at=now)
    ctx = _ctx(like_counts={liked.id: 5}, now=now, order=[1, 2])
    assert lenses.loved(liked, ctx) > lenses.loved(unliked, ctx)


def test_fresh_lens_prefers_newer_by_rank() -> None:
    now = datetime.now(UTC)
    newer = _lens_track(1, play_count=0, created_at=now)
    older = _lens_track(2, play_count=0, created_at=now)
    # recency is by position, not wall-clock: newer ranks ahead of older
    ctx = _ctx(like_counts={}, now=now, order=[newer.id, older.id])
    assert lenses.fresh(newer, ctx) > lenses.fresh(older, ctx)


def test_deep_cuts_prefers_older_underplayed() -> None:
    now = datetime.now(UTC)
    buried = _lens_track(1, play_count=2, created_at=now - timedelta(days=200))
    brand_new = _lens_track(2, play_count=2, created_at=now)
    popular_old = _lens_track(3, play_count=5000, created_at=now - timedelta(days=200))
    ctx = _ctx(like_counts={}, now=now, order=[2, 1, 3])
    # older + underplayed beats both a brand-new unplayed track (that's `fresh`)
    # and an old-but-popular track (that's `loved`)
    assert lenses.deep_cuts(buried, ctx) > lenses.deep_cuts(brand_new, ctx)
    assert lenses.deep_cuts(buried, ctx) > lenses.deep_cuts(popular_old, ctx)


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


async def _create_artist(db_session: AsyncSession, did: str, handle: str) -> Artist:
    artist = Artist(did=did, handle=handle, display_name=handle)
    db_session.add(artist)
    await db_session.flush()
    return artist


async def _create_track(
    db_session: AsyncSession,
    artist: Artist,
    *,
    title: str,
    file_id: str,
    created_at: datetime,
    play_count: int = 0,
    duration: int = 123,
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
        extra={"duration": duration},
        image_url="https://images.example/cover.jpg",
        atproto_record_uri=f"at://{artist.did}/fm.plyr.track/{file_id}",
        play_count=play_count,
        unlisted=unlisted,
        support_gate=support_gate,
    )
    db_session.add(track)
    await db_session.flush()
    return track


async def test_default_station_returns_public_tracks_only(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """default station serves the loved station; unlisted/gated are excluded."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    visible = await _create_track(
        db_session, radio_artist, title="Visible", file_id="visible", created_at=now
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
    # back-compat: omitting ?station serves the default (loved) station, same shape.
    assert data["station_slug"] == "loved"
    assert data["station"] == "loved"
    assert data["current"]["title"] == "Visible"
    assert data["current"]["stream_url"] == (
        f"https://radio.plyr.fm/audio/{visible.file_id}"
    )
    assert data["current"]["duration"] == 123
    assert data["current"]["artwork_url"] == "https://images.example/cover.jpg"
    assert [track["title"] for track in data["rotation"]] == ["Visible"]


async def test_rotation_is_deterministic_per_day(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """same (station, day) yields the same rotation for every client."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    for index in range(8):
        await _create_track(
            db_session,
            radio_artist,
            title=f"t{index}",
            file_id=f"t{index}",
            created_at=now - timedelta(minutes=index),
            play_count=index,
        )
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        first = await client.get("/radio/state.json")
        second = await client.get("/radio/state.json")

    assert first.status_code == 200
    order_a = [t["id"] for t in first.json()["rotation"]]
    order_b = [t["id"] for t in second.json()["rotation"]]
    assert order_a == order_b
    assert len(order_a) == 8


async def test_airtime_cap_prevents_single_artist_domination(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """one artist's long tracks can't swallow the whole rotation."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    # hog: five 10-minute tracks (cap is ~20 min, so at most two get in).
    for index in range(5):
        await _create_track(
            db_session,
            radio_artist,
            title=f"hog{index}",
            file_id=f"hog{index}",
            created_at=now - timedelta(minutes=index),
            duration=600,
        )
    other = await _create_artist(db_session, "did:plc:other", "other.plyr.fm")
    await _create_track(
        db_session, other, title="other", file_id="other", created_at=now, duration=180
    )
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        response = await client.get("/radio/state.json")

    rotation = response.json()["rotation"]
    hog_count = sum(1 for t in rotation if t["artist_did"] == radio_artist.did)
    assert hog_count <= 2  # capped despite five eligible tracks
    assert any(t["artist_did"] == other.did for t in rotation)  # other artist surfaces


async def test_station_param_and_404(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """?station selects a named station; unknown slugs 404."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    await _create_track(
        db_session, radio_artist, title="t", file_id="t", created_at=now
    )
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        fresh = await client.get("/radio/state.json", params={"station": "fresh"})
        unknown = await client.get("/radio/state.json", params={"station": "nope"})

    assert fresh.status_code == 200
    assert fresh.json()["station_slug"] == "fresh"
    assert unknown.status_code == 404


async def test_stations_endpoint_lists_lineup(radio_app: FastAPI) -> None:
    """the lineup endpoint exposes the flippable stations + the default."""
    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        response = await client.get("/radio/stations")

    assert response.status_code == 200
    data = response.json()
    assert data["default_slug"] == "loved"
    slugs = {s["slug"] for s in data["stations"]}
    assert slugs == {"loved", "fresh", "deep-cuts", "slop"}
    default = next(s for s in data["stations"] if s["slug"] == "loved")
    assert default["is_default"] is True


async def _tag_track(db_session: AsyncSession, track: Track, tag_name: str) -> None:
    tag = Tag(name=tag_name, created_by_did=track.artist_did)
    db_session.add(tag)
    await db_session.flush()
    db_session.add(TrackTag(track_id=track.id, tag_id=tag.id))


async def test_slop_station_isolates_ai_tagged_tracks(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """slop holds exactly the ai/suno-tagged tracks; other stations exclude them."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    ai_track = await _create_track(
        db_session, radio_artist, title="Slop Jam", file_id="slop", created_at=now
    )
    await _tag_track(db_session, ai_track, "ai")
    clean_track = await _create_track(
        db_session,
        radio_artist,
        title="Real Jam",
        file_id="clean",
        created_at=now - timedelta(minutes=1),
    )
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        slop = await client.get("/radio/state.json", params={"station": "slop"})
        loved = await client.get("/radio/state.json")

    slop_ids = {t["id"] for t in slop.json()["rotation"]}
    loved_ids = {t["id"] for t in loved.json()["rotation"]}
    assert slop_ids == {ai_track.id}  # slop = only the ai-tagged track
    assert loved_ids == {clean_track.id}  # default station excludes it


async def test_radio_state_includes_tags_and_up_next(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """radio state includes useful metadata for clients."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    first = await _create_track(
        db_session, radio_artist, title="First", file_id="first", created_at=now
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
    # a like so the loved lens has signal to work with
    db_session.add(
        TrackLike(
            track_id=first.id,
            user_did="did:test:liker",
            atproto_like_uri="at://did:test:liker/fm.plyr.like/first",
        )
    )
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
    tagged_track = next(track for track in data["rotation"] if track["id"] == first.id)
    assert tagged_track["tags"] == ["desert"]
    assert data["up_next"]
    assert {track["id"] for track in data["up_next"]}.issubset({first.id, second.id})
