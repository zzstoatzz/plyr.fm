"""Tests for the canonical-URI metrics authority boundary."""

import asyncio

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from backend._internal.track_metrics import increment_track_play_count
from backend.models import Artist, Track, TrackMetric

from ..conftest import session_context


async def test_projection_owns_increment_and_repairs_legacy_mirror(
    db_session: AsyncSession,
) -> None:
    artist = Artist(
        did="did:plc:metrics",
        handle="metrics.test",
        display_name="Metrics",
    )
    track = Track(
        title="Counted",
        artist_did=artist.did,
        file_id="metrics-counted",
        file_type="mp3",
        play_count=4,
        atproto_record_uri="at://did:plc:metrics/fm.plyr.track/counted",
    )
    db_session.add_all([artist, track])
    await db_session.commit()

    assert await increment_track_play_count(db_session, track, source="http_play") == 5
    await db_session.commit()
    metric = await db_session.get(TrackMetric, track.atproto_record_uri)
    assert metric is not None
    assert metric.play_count == 5
    assert metric.write_source == "http_play"

    track.play_count = 1
    await db_session.commit()
    assert (
        await increment_track_play_count(
            db_session,
            track,
            source="subsonic_scrobble",
        )
        == 6
    )
    await db_session.commit()
    await db_session.refresh(track)
    await db_session.refresh(metric)
    assert track.play_count == metric.play_count == 6
    assert metric.write_source == "subsonic_scrobble"


async def test_pre_atproto_track_keeps_legacy_fallback(
    db_session: AsyncSession,
) -> None:
    artist = Artist(
        did="did:plc:legacy-metrics",
        handle="legacy-metrics.test",
        display_name="Legacy Metrics",
    )
    track = Track(
        title="Legacy",
        artist_did=artist.did,
        file_id="metrics-legacy",
        file_type="mp3",
        play_count=2,
    )
    db_session.add_all([artist, track])
    await db_session.commit()

    assert await increment_track_play_count(db_session, track, source="http_play") == 3
    await db_session.commit()
    assert track.play_count == 3


async def test_projection_serializes_concurrent_increments(
    _engine: AsyncEngine,
    _clear_db: None,
) -> None:
    artist = Artist(
        did="did:plc:concurrent-metrics",
        handle="concurrent-metrics.test",
        display_name="Concurrent Metrics",
    )
    track = Track(
        title="Counted Together",
        artist_did=artist.did,
        file_id="metrics-concurrent",
        file_type="mp3",
        atproto_record_uri=("at://did:plc:concurrent-metrics/fm.plyr.track/concurrent"),
    )
    async with session_context(engine=_engine) as seed_db:
        seed_db.add_all([artist, track])
        await seed_db.commit()
        track_id = track.id
        record_uri = track.atproto_record_uri

    async def increment() -> int:
        async with session_context(engine=_engine) as db:
            current = await db.get(Track, track_id)
            assert current is not None
            count = await increment_track_play_count(db, current, source="http_play")
            await db.commit()
            return count

    counts = await asyncio.gather(*(increment() for _ in range(8)))
    assert sorted(counts) == list(range(1, 9))

    async with session_context(engine=_engine) as verify_db:
        mirrored = await verify_db.get(Track, track_id)
        metric = await verify_db.get(TrackMetric, record_uri)
        assert mirrored is not None
        assert metric is not None
        assert mirrored.play_count == metric.play_count == 8
