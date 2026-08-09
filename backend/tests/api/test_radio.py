"""tests for public radio state and the station lineup."""

import asyncio
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, get_optional_session
from backend.api.radio import cache as radio_cache
from backend.api.radio import lenses, stations
from backend.api.radio import live as radio_live
from backend.api.radio import state as radio_state
from backend.api.radio.lenses import LensContext
from backend.api.radio.sampler import (
    ARTIST_SPACING,
    build_rotation,
    rank_decay_weights,
)
from backend.api.radio.schemas import RadioTrack
from backend.config import settings
from backend.main import app
from backend.models import Artist, Tag, Track, TrackLike, TrackTag, get_db


class _MockSession(Session):
    """minimal authenticated session for radio liked-state tests."""

    def __init__(self, did: str) -> None:
        self.did = did
        self.handle = "liker.test"
        self.session_id = "sid"


# clear_database only removes timestamped rows created after test start.
TEST_TIME_OFFSET = timedelta(minutes=10)


@pytest.fixture(autouse=True)
def _rotation_cache_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """keep tests hermetic: each request rebuilds its rotation from this test's data."""
    monkeypatch.setattr(settings.radio, "rotation_cache_ttl_seconds", 0)


class _FakeRedis:
    """minimal in-memory stand-in for the async redis client."""

    def __init__(self) -> None:
        self.store: dict[str, bytes | str] = {}
        self.ttls: dict[str, int | None] = {}

    async def get(self, key: str) -> bytes | str | None:
        return self.store.get(key)

    async def set(
        self,
        key: str,
        value: bytes | str,
        ex: int | None = None,
        nx: bool = False,
    ) -> bool | None:
        if nx and key in self.store:
            return None
        self.store[key] = value
        self.ttls[key] = ex
        return True

    async def delete(self, key: str) -> None:
        self.store.pop(key, None)


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
        visibility="unlisted" if unlisted else "public",
        support_gate=support_gate,
    )
    db_session.add(track)
    await db_session.flush()
    return track


async def test_default_station_returns_public_tracks_only(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """default station serves the loved station; unlisted/gated are excluded."""
    # regression (#1594): stream_url must come from the configured public base
    # URL, not the request scheme — behind Fly's TLS termination the request is
    # plain http, which leaked http:// URLs onto https pages/embedders.
    monkeypatch.setattr(
        settings.atproto, "redirect_uri", "https://api.plyr.fm/auth/callback"
    )
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

    # request over plain http (as Fly's proxy presents it internally) to prove
    # the response URL ignores the request scheme.
    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="http://radio.internal",
    ) as client:
        response = await client.get("/radio/state")

    assert response.status_code == 200
    data = response.json()
    # back-compat: omitting ?station serves the default (loved) station, same shape.
    assert data["station_slug"] == "loved"
    assert data["station"] == "loved"
    assert data["current"]["title"] == "Visible"
    assert data["current"]["stream_url"] == (
        f"https://api.plyr.fm/audio/{visible.file_id}"
    )
    assert data["current"]["duration"] == 123
    assert data["current"]["artwork_url"] == "https://images.example/cover.jpg"
    assert [track["title"] for track in data["rotation"]] == ["Visible"]


def test_rank_decay_weights_zero_the_long_tail() -> None:
    """rank-decay bounds tail mass so a long low-rank tail can't swamp the head.

    Regression: the old per-track weight floor let hundreds of old tracks
    collectively out-mass the few fresh ones, leaking ~200-day tracks into `fresh`.
    """
    weights = rank_decay_weights(list(range(200)), 12.0)
    assert weights[0] == 1.0
    assert weights[1] < weights[0]
    # a rank-150 track is effectively weightless next to the head
    assert weights[150] / weights[0] < 1e-4
    # total mass stays ~bounded (≈scale) regardless of the 200-item length
    assert sum(weights.values()) < 20


def _sampler_track(track_id: int, *, artist_did: str) -> Track:
    return Track(
        id=track_id,
        artist_did=artist_did,
        play_count=0,
        created_at=datetime.now(UTC),
        extra={"duration": 180},
    )


def test_rotation_reseeds_across_periods() -> None:
    """different periods produce different rotations from the same corpus.

    Regression: rotations used to reseed once per calendar day, so a listener
    with a fixed daily listening window heard the same slice every day.
    """
    corpus = [_sampler_track(i, artist_did=f"did:plc:a{i}") for i in range(200)]
    weights = rank_decay_weights([t.id for t in corpus], 12.0)
    rotations = [
        [
            t.id
            for t in build_rotation(
                corpus,
                weights,
                station_slug="loved",
                period=str(period),
                max_tracks=40,
            )
        ]
        for period in range(3)
    ]
    assert rotations[0] == [
        t.id
        for t in build_rotation(
            corpus, weights, station_slug="loved", period="0", max_tracks=40
        )
    ]  # deterministic within a period
    assert rotations[0] != rotations[1] != rotations[2]


def test_exploration_floor_reaches_the_dormant_tail() -> None:
    """uniform exploration draws make the deep tail reachable.

    Regression: with a static ranking and rank-decay weights alone, nothing past
    ~rank 85 ever aired — 14 simulated days touched only ~8% of a 918-track
    corpus. The exploration floor guarantees deep ranks get airtime.
    """
    corpus = [_sampler_track(i, artist_did=f"did:plc:a{i}") for i in range(900)]
    weights = rank_decay_weights([t.id for t in corpus], 12.0)

    def reach(exploration: float) -> set[int]:
        drawn: set[int] = set()
        for period in range(20):
            drawn.update(
                t.id
                for t in build_rotation(
                    corpus,
                    weights,
                    station_slug="loved",
                    period=str(period),
                    max_tracks=40,
                    exploration=exploration,
                )
            )
        return drawn

    weighted_only = reach(0.0)
    with_floor = reach(0.25)
    assert max(weighted_only) < 150  # the tail is unreachable without the floor
    assert max(with_floor) > 500
    assert len(with_floor) > len(weighted_only)


def test_rotation_never_stacks_one_artist_back_to_back() -> None:
    """no artist airs twice within the spacing window, including across the loop seam.

    Regression: the airtime cap bounded an artist's *total* share but not its
    clustering, so a heavily-liked creator could air several tracks in a row.
    """
    corpus = [
        _sampler_track(i, artist_did="did:plc:hog" if i < 30 else f"did:plc:a{i}")
        for i in range(60)
    ]
    weights = rank_decay_weights([t.id for t in corpus], 12.0)
    for period in range(20):
        rotation = build_rotation(
            corpus,
            weights,
            station_slug="loved",
            period=str(period),
            max_tracks=40,
        )
        dids = [t.artist_did for t in rotation]
        looped = dids + dids[:ARTIST_SPACING]  # the rotation replays from the top
        for start in range(len(dids)):
            window = looped[start : start + ARTIST_SPACING + 1]
            assert len(set(window)) == len(window), f"{period}: {window}"


def test_rotation_still_fills_when_one_artist_owns_the_corpus() -> None:
    """spacing relaxes rather than starving the rotation on a thin corpus."""
    corpus = [_sampler_track(i, artist_did="did:plc:solo") for i in range(10)]
    weights = rank_decay_weights([t.id for t in corpus], 12.0)
    rotation = build_rotation(
        corpus, weights, station_slug="loved", period="0", max_tracks=40
    )
    assert len(rotation) > 1


async def test_rotation_is_deterministic_within_a_period(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """same (station, period) yields the same rotation for every client."""
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
    assert slugs == {"loved", "fresh", "deep-cuts", "slop", "firehose"}
    default = next(s for s in data["stations"] if s["slug"] == "loved")
    assert default["is_default"] is True


async def _tag_track(db_session: AsyncSession, track: Track, tag_name: str) -> None:
    existing = (
        await db_session.execute(select(Tag).where(Tag.name == tag_name))
    ).scalar_one_or_none()
    if existing is None:
        existing = Tag(name=tag_name, created_by_did=track.artist_did)
        db_session.add(existing)
        await db_session.flush()
    db_session.add(TrackTag(track_id=track.id, tag_id=existing.id))


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


async def test_slop_excludes_plyr_fm_account_tracks(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """the plyr.fm account's ai-tagged update posts are kept out of slop."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    plyr = await _create_artist(db_session, "did:plc:plyrfm", "plyr.fm")
    plyr_track = await _create_track(
        db_session, plyr, title="plyr.fm update", file_id="update", created_at=now
    )
    await _tag_track(db_session, plyr_track, "ai")
    other_slop = await _create_track(
        db_session,
        radio_artist,
        title="Real Slop",
        file_id="realslop",
        created_at=now - timedelta(minutes=1),
    )
    await _tag_track(db_session, other_slop, "ai")
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        slop = await client.get("/radio/state.json", params={"station": "slop"})

    slop_ids = {t["id"] for t in slop.json()["rotation"]}
    assert slop_ids == {other_slop.id}  # plyr.fm's ai track excluded


async def test_radio_excludes_deactivated_artists(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """tracks from deactivated accounts drop out of radio (their audio is dead)."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    live = await _create_track(
        db_session, radio_artist, title="Live", file_id="live", created_at=now
    )
    gone = await _create_artist(db_session, "did:plc:gone", "gone.plyr.fm")
    gone.deactivated = True
    gone_track = await _create_track(
        db_session,
        gone,
        title="Gone",
        file_id="gone",
        created_at=now - timedelta(minutes=1),
    )
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        response = await client.get("/radio/state.json")

    ids = {t["id"] for t in response.json()["rotation"]}
    assert live.id in ids
    assert gone_track.id not in ids


async def test_radio_excludes_moderation_override_exclude(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """a standing `exclude` override keeps a track off radio, no label needed.

    regression: load_corpus filtered on labels only, so an operator exclude
    (user report: prayer recordings airing on radio) removed a track from
    discovery feeds but radio kept broadcasting it.
    """
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    airing = await _create_track(
        db_session, radio_artist, title="Airing", file_id="airing", created_at=now
    )
    excluded = await _create_track(
        db_session,
        radio_artist,
        title="Excluded",
        file_id="excluded",
        created_at=now - timedelta(minutes=1),
    )
    excluded.moderation_override = "exclude"
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        response = await client.get("/radio/state.json")

    ids = {t["id"] for t in response.json()["rotation"]}
    assert airing.id in ids
    assert excluded.id not in ids


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


async def test_radio_marks_liked_tracks_for_authenticated_user(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """the requesting user's likes surface as `liked` on radio tracks."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    liked = await _create_track(
        db_session, radio_artist, title="Liked", file_id="liked", created_at=now
    )
    plain = await _create_track(
        db_session,
        radio_artist,
        title="Plain",
        file_id="plain",
        created_at=now - timedelta(minutes=1),
    )
    db_session.add(
        TrackLike(
            track_id=liked.id,
            user_did="did:test:user123",
            atproto_like_uri="at://did:test:user123/fm.plyr.like/liked",
        )
    )
    await db_session.commit()

    async def mock_session() -> Session:
        return _MockSession("did:test:user123")

    # unauthenticated: nothing is liked
    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        anon = await client.get("/radio/state.json")
    assert anon.status_code == 200
    assert all(not track["liked"] for track in anon.json()["rotation"])

    # authenticated: only the user's liked track is flagged
    radio_app.dependency_overrides[get_optional_session] = mock_session
    try:
        async with AsyncClient(
            transport=ASGITransport(app=radio_app),
            base_url="https://radio.plyr.fm",
        ) as client:
            response = await client.get("/radio/state.json")
    finally:
        del radio_app.dependency_overrides[get_optional_session]

    assert response.status_code == 200
    rotation = {track["id"]: track["liked"] for track in response.json()["rotation"]}
    assert rotation[liked.id] is True
    assert rotation[plain.id] is False


# --- rotation cache (#1671) --------------------------------------------------
# regression: every /radio/state poll rebuilt the rotation from the full
# eligible catalog; under real listener volume that saturated the database
# (2026-07-14) and slowed every endpoint. The rotation is deterministic per
# (station, limit, period), so it's cached anonymously and the requesting
# user's likes are overlaid per request.


@pytest.fixture
def rotation_cache(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    """enable the rotation cache against an in-memory redis."""
    fake = _FakeRedis()
    monkeypatch.setattr(settings.radio, "rotation_cache_ttl_seconds", 60)
    monkeypatch.setattr(radio_cache, "get_async_redis_client", lambda: fake)
    return fake


async def test_cached_rotation_skips_corpus_reload(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
    rotation_cache: _FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """the second poll within the TTL serves the cached rotation."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    await _create_track(
        db_session, radio_artist, title="Cached", file_id="cached", created_at=now
    )
    await db_session.commit()

    corpus_calls = 0
    real_load_corpus = radio_state.load_corpus

    async def counting_load_corpus(db: AsyncSession) -> list[Track]:
        nonlocal corpus_calls
        corpus_calls += 1
        return await real_load_corpus(db)

    monkeypatch.setattr(radio_state, "load_corpus", counting_load_corpus)

    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        first = await client.get("/radio/state.json")
        second = await client.get("/radio/state.json")

    assert first.status_code == second.status_code == 200
    assert corpus_calls == 1
    assert rotation_cache.store  # the rotation actually landed in the cache
    assert [t["id"] for t in first.json()["rotation"]] == [
        t["id"] for t in second.json()["rotation"]
    ]


async def test_cached_rotation_is_anonymous_with_per_request_likes(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
    rotation_cache: _FakeRedis,
) -> None:
    """a signed-in warmup can't leak liked=True to others; hits still get likes."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    liked = await _create_track(
        db_session, radio_artist, title="Liked", file_id="liked", created_at=now
    )
    db_session.add(
        TrackLike(
            track_id=liked.id,
            user_did="did:test:user123",
            atproto_like_uri="at://did:test:user123/fm.plyr.like/liked",
        )
    )
    await db_session.commit()

    async def mock_session() -> Session:
        return _MockSession("did:test:user123")

    # signed-in request warms the cache
    radio_app.dependency_overrides[get_optional_session] = mock_session
    try:
        async with AsyncClient(
            transport=ASGITransport(app=radio_app),
            base_url="https://radio.plyr.fm",
        ) as client:
            warm = await client.get("/radio/state.json")
    finally:
        del radio_app.dependency_overrides[get_optional_session]

    assert {t["id"]: t["liked"] for t in warm.json()["rotation"]}[liked.id] is True

    # anonymous cache hit: no liked state leaks
    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        anon = await client.get("/radio/state.json")
    assert all(not track["liked"] for track in anon.json()["rotation"])

    # signed-in cache hit: likes overlaid on the cached rotation
    radio_app.dependency_overrides[get_optional_session] = mock_session
    try:
        async with AsyncClient(
            transport=ASGITransport(app=radio_app),
            base_url="https://radio.plyr.fm",
        ) as client:
            hit = await client.get("/radio/state.json")
    finally:
        del radio_app.dependency_overrides[get_optional_session]
    assert {t["id"]: t["liked"] for t in hit.json()["rotation"]}[liked.id] is True


async def test_concurrent_cache_misses_build_once(
    rotation_cache: _FakeRedis,
) -> None:
    """expiry doesn't stampede: concurrent misses coalesce onto one build."""
    builds = 0

    async def build() -> list[RadioTrack]:
        nonlocal builds
        builds += 1
        # hold the build lock long enough for the other misses to arrive
        await asyncio.sleep(0.3)
        return [
            RadioTrack(
                id=1,
                title="t",
                artist="a",
                artist_handle="a.plyr.fm",
                artist_did="did:plc:a",
                stream_url="https://api.plyr.fm/audio/t",
                file_type="mp3",
                duration=180,
                artwork_url=None,
                thumbnail_url=None,
                atproto_record_uri=None,
                atproto_record_cid=None,
                created_at="2026-07-14T00:00:00+00:00",
                tags=[],
                like_count=0,
                play_count=0,
            )
        ]

    results = await asyncio.gather(
        *(radio_cache.get_rotation("loved", 40, "period", build, 60) for _ in range(10))
    )

    assert builds == 1
    assert all(rotation == results[0] for rotation in results)
    assert all(rotation[0].id == 1 for rotation in results)


# --- the firehose station: live preempts, rotation is the fallback ---


@pytest.fixture(autouse=True)
def _clear_live_cache() -> Generator[None, None, None]:
    radio_live.reset_cache()
    yield
    radio_live.reset_cache()


def _firehose_station() -> stations.Station:
    station = stations.get_station("firehose")
    assert station is not None
    return station


async def test_live_broadcast_preempts_but_rotation_still_resolves(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """while airing, `live` is set — and the loop keeps running underneath it.

    the rotation is what resumes when the broadcast ends, so it must still be
    described rather than blanked out.
    """
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    radio_artist.handle = stations.FIREHOSE_PUBLISHER_HANDLE
    await _create_track(
        db_session, radio_artist, title="segment", file_id="seg", created_at=now
    )
    await db_session.commit()

    broadcast = radio_live.LiveBroadcast(
        stream_url="https://example.test/live/index.m3u8",
        kind="hls",
        started_at="2026-07-30T19:12:32Z",
    )
    with patch.object(radio_live, "_probe", AsyncMock(return_value=broadcast)):
        async with AsyncClient(
            transport=ASGITransport(app=radio_app),
            base_url="https://radio.plyr.fm",
        ) as client:
            response = await client.get(
                "/radio/state.json", params={"station": "firehose"}
            )

    assert response.status_code == 200
    body = response.json()
    assert body["live"]["stream_url"] == "https://example.test/live/index.m3u8"
    assert body["live"]["kind"] == "hls"
    # the clock underneath is untouched
    assert body["current"] is not None
    assert body["loop_duration_seconds"] > 0


async def test_off_air_falls_back_to_the_rotation(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    radio_artist.handle = stations.FIREHOSE_PUBLISHER_HANDLE
    await _create_track(
        db_session, radio_artist, title="segment", file_id="seg", created_at=now
    )
    await db_session.commit()

    with patch.object(radio_live, "_probe", AsyncMock(return_value=None)):
        async with AsyncClient(
            transport=ASGITransport(app=radio_app),
            base_url="https://radio.plyr.fm",
        ) as client:
            response = await client.get(
                "/radio/state.json", params={"station": "firehose"}
            )

    body = response.json()
    assert body["live"] is None
    assert body["current"]["title"] == "segment"


async def test_an_unreachable_broadcaster_is_off_air_not_an_error(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """fail closed: never hand a client a stream URL that won't load."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    radio_artist.handle = stations.FIREHOSE_PUBLISHER_HANDLE
    await _create_track(
        db_session, radio_artist, title="segment", file_id="seg", created_at=now
    )
    await db_session.commit()

    async def _boom(source: stations.LiveSource) -> None:
        raise RuntimeError("connection refused")

    with patch.object(radio_live.httpx, "AsyncClient", side_effect=_boom):
        async with AsyncClient(
            transport=ASGITransport(app=radio_app),
            base_url="https://radio.plyr.fm",
        ) as client:
            response = await client.get(
                "/radio/state.json", params={"station": "firehose"}
            )

    assert response.status_code == 200
    assert response.json()["live"] is None


async def test_stations_without_a_live_source_never_probe(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """the other four stations must not pay for this feature."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    await _create_track(
        db_session, radio_artist, title="t", file_id="t", created_at=now
    )
    await db_session.commit()

    probe = AsyncMock(return_value=None)
    with patch.object(radio_live, "_probe", probe):
        async with AsyncClient(
            transport=ASGITransport(app=radio_app),
            base_url="https://radio.plyr.fm",
        ) as client:
            response = await client.get(
                "/radio/state.json", params={"station": "loved"}
            )

    assert response.json()["live"] is None
    probe.assert_not_awaited()


async def test_liveness_is_cached_across_requests(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """one probe per window regardless of audience size."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    radio_artist.handle = stations.FIREHOSE_PUBLISHER_HANDLE
    await _create_track(
        db_session, radio_artist, title="segment", file_id="seg", created_at=now
    )
    await db_session.commit()

    probe = AsyncMock(return_value=None)
    with patch.object(radio_live, "_probe", probe):
        async with AsyncClient(
            transport=ASGITransport(app=radio_app),
            base_url="https://radio.plyr.fm",
        ) as client:
            for _ in range(4):
                await client.get("/radio/state.json", params={"station": "firehose"})

    assert probe.await_count == 1


async def test_the_firehose_station_only_airs_its_publisher(
    db_session: AsyncSession,
) -> None:
    """off-air fallback stays about the firehose, not arbitrary music."""
    station = _firehose_station()
    mine = MagicMock(spec=Track)
    mine.artist.handle = stations.FIREHOSE_PUBLISHER_HANDLE
    theirs = MagicMock(spec=Track)
    theirs.artist.handle = "someone.else"
    assert station.corpus_filter(mine, set()) is True
    assert station.corpus_filter(theirs, set()) is False


async def test_firehose_station_is_in_the_lineup(radio_app: FastAPI) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        response = await client.get("/radio/stations")

    slugs = [s["slug"] for s in response.json()["stations"]]
    assert "firehose" in slugs
    # it must not become the default — that is what every legacy client gets
    assert response.json()["default_slug"] != "firehose"


async def test_a_broadcast_carries_its_own_artwork(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    """the broadcaster owns its cover — a sonification renders one per interval."""
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    radio_artist.handle = stations.FIREHOSE_PUBLISHER_HANDLE
    await _create_track(
        db_session, radio_artist, title="segment", file_id="seg", created_at=now
    )
    await db_session.commit()

    payload = {
        "live": True,
        "started_at": "2026-07-30T19:12:32Z",
        "artwork_url": "https://relay.test/sonify/live/cover.png",
    }
    response_stub = MagicMock()
    response_stub.json.return_value = payload
    response_stub.raise_for_status.return_value = None
    client_stub = MagicMock()
    client_stub.__aenter__ = AsyncMock(return_value=client_stub)
    client_stub.__aexit__ = AsyncMock(return_value=False)
    client_stub.get = AsyncMock(return_value=response_stub)

    with patch.object(radio_live.httpx, "AsyncClient", return_value=client_stub):
        async with AsyncClient(
            transport=ASGITransport(app=radio_app),
            base_url="https://radio.plyr.fm",
        ) as client:
            response = await client.get(
                "/radio/state.json", params={"station": "firehose"}
            )

    live = response.json()["live"]
    assert live["artwork_url"] == "https://relay.test/sonify/live/cover.png"


async def test_a_broadcast_without_artwork_is_still_valid(
    radio_app: FastAPI,
    db_session: AsyncSession,
    radio_artist: Artist,
) -> None:
    now = datetime.now(UTC) + TEST_TIME_OFFSET
    radio_artist.handle = stations.FIREHOSE_PUBLISHER_HANDLE
    await _create_track(
        db_session, radio_artist, title="segment", file_id="seg", created_at=now
    )
    await db_session.commit()

    broadcast = radio_live.LiveBroadcast(
        stream_url="https://relay.test/live/index.m3u8", kind="hls", started_at=None
    )
    with patch.object(radio_live, "_probe", AsyncMock(return_value=broadcast)):
        async with AsyncClient(
            transport=ASGITransport(app=radio_app),
            base_url="https://radio.plyr.fm",
        ) as client:
            response = await client.get(
                "/radio/state.json", params={"station": "firehose"}
            )

    assert response.json()["live"]["artwork_url"] is None


# --- the playlist gets the last word on liveness ---


def _playlist(*, age_seconds: float, ended: bool = False, stamped: bool = True) -> str:
    stamp = (datetime.now(UTC) - timedelta(seconds=age_seconds)).isoformat()
    lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:4"]
    lines.append("#EXTINF:3.99,")
    if stamped:
        lines.append(f"#EXT-X-PROGRAM-DATE-TIME:{stamp}")
    lines.append("segment-000000001.ts")
    if ended:
        lines.append("#EXT-X-ENDLIST")
    return "\n".join(lines)


def _health_client(payload: dict, playlist: str | None = None) -> MagicMock:
    """stub httpx.AsyncClient: health json first, playlist text after."""
    health = MagicMock()
    health.json.return_value = payload
    health.raise_for_status.return_value = None
    health.text = ""
    pl = MagicMock()
    pl.raise_for_status.return_value = None
    pl.text = playlist or ""
    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    client.get = AsyncMock(side_effect=[health, pl])
    return client


class TestLivenessFallsBackToThePlaylist:
    """a broadcaster reported itself down while its playlist kept advancing.

    observed 2026-07-30: `{"live": false}` with MEDIA-SEQUENCE climbing and
    segments decoding fine. the listener could have heard it; the station said
    off air. the playlist is what actually gets played, so it decides.
    """

    async def test_advancing_playlist_overrides_a_down_report(self) -> None:
        radio_live.reset_cache()
        source = stations.LiveSource(
            stream_url="https://relay.test/live/index.m3u8",
            health_url="https://relay.test/health",
        )
        client = _health_client({"live": False}, _playlist(age_seconds=3))
        with patch.object(radio_live.httpx, "AsyncClient", return_value=client):
            result = await radio_live.get_live_broadcast(source)
        assert result is not None
        assert result.stream_url == "https://relay.test/live/index.m3u8"

    async def test_a_stale_playlist_stays_off_air(self) -> None:
        radio_live.reset_cache()
        source = stations.LiveSource(
            stream_url="https://relay.test/live/index.m3u8",
            health_url="https://relay.test/health",
        )
        client = _health_client({"live": False}, _playlist(age_seconds=600))
        with patch.object(radio_live.httpx, "AsyncClient", return_value=client):
            assert await radio_live.get_live_broadcast(source) is None

    async def test_an_ended_playlist_stays_off_air(self) -> None:
        radio_live.reset_cache()
        source = stations.LiveSource(
            stream_url="https://relay.test/live/index.m3u8",
            health_url="https://relay.test/health",
        )
        client = _health_client({"live": False}, _playlist(age_seconds=1, ended=True))
        with patch.object(radio_live.httpx, "AsyncClient", return_value=client):
            assert await radio_live.get_live_broadcast(source) is None

    async def test_a_healthy_report_never_fetches_the_playlist(self) -> None:
        """the second opinion is only for a *negative* report."""
        radio_live.reset_cache()
        source = stations.LiveSource(
            stream_url="https://relay.test/live/index.m3u8",
            health_url="https://relay.test/health",
        )
        client = _health_client({"live": True, "artwork_url": "https://a.test/c.png"})
        with patch.object(radio_live.httpx, "AsyncClient", return_value=client):
            result = await radio_live.get_live_broadcast(source)
        assert result is not None
        assert result.artwork_url == "https://a.test/c.png"
        assert client.get.await_count == 1


async def test_a_station_can_credit_where_its_audio_comes_from(
    radio_app: FastAPI,
) -> None:
    """firehose airs someone else's broadcast; the lineup links back to it."""
    async with AsyncClient(
        transport=ASGITransport(app=radio_app),
        base_url="https://radio.plyr.fm",
    ) as client:
        response = await client.get("/radio/stations")

    by_slug = {s["slug"]: s for s in response.json()["stations"]}
    assert by_slug["firehose"]["source_url"] == "https://relay-eval.waow.tech/sonify"
    # a station built from the local catalog has no elsewhere to point at
    assert by_slug["loved"]["source_url"] is None


# --- rotation continuity (mid-song switches) ---------------------------------
# regression for the "radio randomly changes track mid-song" reports: the
# rotation must stay pinned for its whole period (rebuilds see moved scores and
# reshuffle the loop), and period handovers must land on track boundaries
# instead of dropping the wall-clock into the middle of an arbitrary track.


def _rotation_track(track_id: int, duration: int) -> RadioTrack:
    return RadioTrack(
        id=track_id,
        title=f"t{track_id}",
        artist="a",
        artist_handle="a.plyr.fm",
        artist_did="did:plc:a",
        stream_url=f"https://api.plyr.fm/audio/t{track_id}",
        file_type="mp3",
        duration=duration,
        artwork_url=None,
        thumbnail_url=None,
        atproto_record_uri=None,
        atproto_record_cid=None,
        created_at="2026-07-14T00:00:00+00:00",
        tags=[],
        like_count=0,
        play_count=0,
    )


def _epoch(seconds: float) -> datetime:
    return datetime.fromtimestamp(seconds, UTC)


def test_live_window_is_anchored_not_epoch_modulus() -> None:
    """track boundaries derive from the anchor, so a loop starts at track 0."""
    rotation = [_rotation_track(1, 100), _rotation_track(2, 200)]
    anchor = 1_000_000.0

    index, progress, _, _ = radio_state._live_window(
        _epoch(anchor + 30), rotation, anchor
    )
    assert (index, progress) == (0, 30)

    index, progress, _, _ = radio_state._live_window(
        _epoch(anchor + 150), rotation, anchor
    )
    assert (index, progress) == (1, 50)

    # wraps on the loop, still anchored
    index, progress, _, _ = radio_state._live_window(
        _epoch(anchor + 300 + 10), rotation, anchor
    )
    assert (index, progress) == (0, 10)


def test_crossing_track_end_extends_past_the_boundary() -> None:
    """a track straddling the period boundary finishes before handover."""
    rotation = [_rotation_track(1, 100), _rotation_track(2, 200)]
    anchor = 0.0
    # boundary lands 40s into track 2 (offset 140 of the 300s loop)
    boundary = 300.0 * 7 + 140
    assert radio_state._crossing_track_end(rotation, anchor, boundary) == boundary + 160

    # a boundary exactly on a track edge hands over immediately
    edge = 300.0 * 7 + 100
    assert radio_state._crossing_track_end(rotation, anchor, edge) == edge + 200


async def test_rotation_cache_pins_for_the_full_period(
    rotation_cache: _FakeRedis,
) -> None:
    """a rebuild mid-period must serve the pinned rotation, not a reshuffle.

    the sampler's ranking reads live signals, so the second build here returns
    a different sequence — the cache must never let that reach listeners
    within the period.
    """
    first = [_rotation_track(1, 100), _rotation_track(2, 200)]
    second = [_rotation_track(2, 200), _rotation_track(1, 100)]
    builds = iter([first, second])

    async def build() -> list[RadioTrack]:
        return next(builds)

    got_first = await radio_cache.get_rotation("loved", 40, "p1", build, 15_000)
    got_again = await radio_cache.get_rotation("loved", 40, "p1", build, 15_000)
    assert [t.id for t in got_again] == [t.id for t in got_first] == [1, 2]

    # and the entry's TTL is period-scale, not the old 60s
    key = radio_cache.rotation_cache_key("loved", 40, "p1")
    assert rotation_cache.ttls[key] == 15_000


async def test_period_handover_lands_on_track_boundary(
    rotation_cache: _FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """crossing a period boundary finishes the in-flight track, then starts the
    new rotation from track 0 — never a mid-song teleport."""
    from pydantic import TypeAdapter

    period = radio_state.ROTATION_PERIOD_SECONDS
    prev_rotation = [_rotation_track(1, 1000), _rotation_track(2, 3600)]
    new_rotation = [_rotation_track(3, 500), _rotation_track(4, 700)]

    async def fake_load_rotation(
        db: object,
        station: stations.Station,
        limit: int,
        now: datetime,
        period_index: int,
    ) -> list[RadioTrack]:
        return new_rotation

    monkeypatch.setattr(radio_state, "_load_rotation", fake_load_rotation)
    station = stations.get_station(None)
    assert station is not None

    period_index = 1000
    boundary = float(period_index * period)

    # the previous period actually aired: its rotation sits in the cache and
    # its loop was anchored at its own period start.
    adapter = TypeAdapter(list[RadioTrack])
    rotation_cache.store[
        radio_cache.rotation_cache_key(station.slug, 40, str(period_index - 1))
    ] = adapter.dump_json(prev_rotation)

    # the previous loop is 4600s; the boundary lands 14400 % 4600 = 600s in,
    # i.e. 600s into track 1 (1000s long), which has 400s left to play.
    offset_at_boundary = period % 4600
    assert offset_at_boundary == 600
    expected_anchor = boundary + 400

    # just after the boundary: still the previous rotation's in-flight track,
    # and the new rotation's head is advertised as what's next
    now = _epoch(boundary + 5)
    rotation, anchor, upcoming = await radio_state._station_clock(
        MagicMock(spec=AsyncSession), station, 40, now
    )
    assert [t.id for t in rotation] == [1, 2]
    index, progress, _, _ = radio_state._live_window(now, rotation, anchor)
    assert index is not None
    assert (rotation[index].id, progress) == (1, 605)
    assert upcoming is not None and upcoming[0].id == 3

    # after the crossing track ends: the new rotation, starting at track 0
    now = _epoch(expected_anchor + 5)
    rotation, anchor, upcoming = await radio_state._station_clock(
        MagicMock(spec=AsyncSession), station, 40, now
    )
    assert [t.id for t in rotation] == [3, 4]
    assert anchor == expected_anchor
    assert upcoming is None
    index, progress, _, _ = radio_state._live_window(now, rotation, anchor)
    assert index is not None
    assert (rotation[index].id, progress) == (3, 5)


async def test_cold_cache_boundary_anchors_at_period_start(
    rotation_cache: _FakeRedis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """with no record of the previous period, the new loop starts cleanly at
    the boundary — a rebuilt guess of a lost rotation must not hand over."""
    new_rotation = [_rotation_track(3, 500), _rotation_track(4, 700)]

    async def fake_load_rotation(
        db: object,
        station: stations.Station,
        limit: int,
        now: datetime,
        period_index: int,
    ) -> list[RadioTrack]:
        return new_rotation

    monkeypatch.setattr(radio_state, "_load_rotation", fake_load_rotation)
    station = stations.get_station(None)
    assert station is not None

    boundary = float(1000 * radio_state.ROTATION_PERIOD_SECONDS)
    now = _epoch(boundary + 30)
    rotation, anchor, upcoming = await radio_state._station_clock(
        MagicMock(spec=AsyncSession), station, 40, now
    )
    assert anchor == boundary
    assert upcoming is None
    index, progress, _, _ = radio_state._live_window(now, rotation, anchor)
    assert index is not None
    assert (rotation[index].id, progress) == (3, 30)
