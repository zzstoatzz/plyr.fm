"""Public live radio state for simple clients and games.

The response is a deterministic wall-clock loop: every client gets the same
current track for a given instant, per station. Determinism is anchored in the
shared cache — the first rotation built in a period is pinned for that period,
and each period's loop starts from a pinned anchor (the moment the previous
period's in-flight track ended), so nothing ever changes or jumps mid-song.
Without Redis this degrades to per-period start anchoring: still deterministic
per instant, with a clean track start at each period boundary. Station
selection (which tracks, in what order) lives in ``corpus`` / ``lenses`` /
``sampler``; this module owns the HTTP surface and the loop arithmetic.
"""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import urljoin

from fastapi import Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session as AuthSession
from backend._internal import get_optional_session
from backend.api.radio import stations
from backend.api.radio.cache import get_period_anchor, get_rotation, peek_rotation
from backend.api.radio.corpus import load_corpus
from backend.api.radio.lenses import LensContext
from backend.api.radio.live import get_live_broadcast
from backend.api.radio.router import router
from backend.api.radio.sampler import build_rotation, rank_decay_weights
from backend.api.radio.schemas import (
    LiveBroadcastInfo,
    RadioStateResponse,
    RadioTrack,
    StationsResponse,
    StationSummary,
)
from backend.config import settings
from backend.models import Track, get_db
from backend.utilities.aggregations import (
    get_like_counts,
    get_track_tags,
    get_user_liked_track_ids,
)

DEFAULT_TRACK_SECONDS = 180
DEFAULT_ROTATION_SIZE = 40
MAX_ROTATION_SIZE = 75
# a rotation lasts one period, then reseeds. Reseeding a few times a day (rather
# than daily) keeps a listener with a fixed daily listening window from landing
# on the same slice of the same rotation every day, while every client still
# computes the identical rotation within a period.
ROTATION_PERIOD_SECONDS = 4 * 60 * 60
# rotation cache entries must survive their own period plus the next one, so
# the boundary handover can look back at the previous period's rotation.
ROTATION_CACHE_MARGIN_SECONDS = 10 * 60


def _stream_url(track: Track) -> str:
    """Return the existing audio redirect endpoint as an absolute URL.

    Built from the configured public base URL rather than the request scheme,
    which is ``http`` behind Fly's TLS termination and would emit mixed-content
    URLs to https pages and embedders.
    """
    return urljoin(settings.atproto.base_url + "/", f"audio/{track.file_id}")


def _duration_seconds(track: Track) -> int:
    """Return a usable duration for scheduling."""
    if track.duration and track.duration > 0:
        return int(track.duration)
    return DEFAULT_TRACK_SECONDS


async def _select_rotation(
    db: AsyncSession,
    station: stations.Station,
    limit: int,
    now: datetime,
) -> tuple[list[Track], dict[int, int]]:
    """Score the station's eligible corpus through its lens and sample a rotation.

    Returns the chosen tracks plus their like counts (reused for serialization so
    we only count likes once).
    """
    corpus = await load_corpus(db)
    if not corpus:
        return [], {}

    # a station's corpus_filter decides eligibility from a track's tags (e.g.
    # `slop` keeps only ai/suno-tagged tracks; every other station excludes them).
    tag_map = await get_track_tags(db, [track.id for track in corpus])
    eligible = [t for t in corpus if station.corpus_filter(t, tag_map.get(t.id, set()))]
    if not eligible:
        return [], {}

    like_counts = await get_like_counts(db, [track.id for track in eligible])
    # eligible keeps the newest-first corpus order, so enumeration is the recency
    # rank within this station's pool.
    recency_rank = {track.id: rank for rank, track in enumerate(eligible)}
    ctx = LensContext(like_counts=like_counts, now=now, recency_rank=recency_rank)
    # rank by the station's lens, then weight by rank-decay (not the raw score):
    # weighting by rank keeps one station's signal from swamping another and
    # bounds the tail mass regardless of catalog size, so e.g. a 200-day-old
    # track can't leak into `fresh`. The decay scale is per-station.
    ranked = sorted(eligible, key=lambda t: station.lens(t, ctx), reverse=True)
    weights = rank_decay_weights([t.id for t in ranked], station.rank_decay)
    rotation = build_rotation(
        eligible,
        weights,
        station_slug=station.slug,
        period=str(int(now.timestamp()) // ROTATION_PERIOD_SECONDS),
        max_tracks=limit,
        exploration=station.exploration,
    )
    return rotation, like_counts


async def _to_radio_tracks(
    db: AsyncSession,
    tracks: list[Track],
    like_counts: dict[int, int],
) -> list[RadioTrack]:
    """Serialize tracks for public radio consumers (anonymous: liked=False)."""
    track_ids = [track.id for track in tracks]
    tag_map = await get_track_tags(db, track_ids)
    return [
        RadioTrack(
            id=track.id,
            title=track.title,
            artist=track.artist.display_name,
            artist_handle=track.artist.handle,
            artist_did=track.artist_did,
            stream_url=_stream_url(track),
            file_type=track.file_type,
            duration=_duration_seconds(track),
            artwork_url=track.image_url or track.artist.avatar_url,
            thumbnail_url=track.thumbnail_url,
            atproto_record_uri=track.atproto_record_uri,
            atproto_record_cid=track.atproto_record_cid,
            created_at=track.created_at.isoformat(),
            tags=sorted(tag_map.get(track.id, set())),
            like_count=like_counts.get(track.id, 0),
            play_count=track.play_count,
        )
        for track in tracks
    ]


async def _load_rotation(
    db: AsyncSession,
    station: stations.Station,
    limit: int,
    now: datetime,
    period_index: int,
) -> list[RadioTrack]:
    """Return the station's anonymous rotation, cached per (station, limit, period).

    The cache is what makes the rotation actually stable within a period: the
    sampler's ranking reads live signals (plays, likes, corpus order), so a
    rebuild would produce a different sequence and teleport the wall-clock
    playhead mid-song (the pre-2026-08 60s TTL did exactly that). The first
    build in a period is therefore pinned for the whole period, plus one more
    period so the boundary handover can look back at it. Caching also bounds
    the full-catalog recomputation that saturated the database (2026-07-14).
    """

    async def build() -> list[RadioTrack]:
        tracks, like_counts = await _select_rotation(db, station, limit, now)
        return await _to_radio_tracks(db, tracks, like_counts)

    period_end = (period_index + 1) * ROTATION_PERIOD_SECONDS
    ttl = (
        max(0, period_end - int(now.timestamp()))
        + ROTATION_PERIOD_SECONDS
        + ROTATION_CACHE_MARGIN_SECONDS
    )
    return await get_rotation(station.slug, limit, str(period_index), build, ttl)


async def _with_liked_state(
    db: AsyncSession,
    rotation: list[RadioTrack],
    session: AuthSession | None,
) -> list[RadioTrack]:
    """Overlay the requesting user's likes on an anonymous rotation."""
    if session is None or not rotation:
        return rotation
    liked_ids = await get_user_liked_track_ids(
        db, session.did, [track.id for track in rotation]
    )
    if not liked_ids:
        return rotation
    return [
        track.model_copy(update={"liked": track.id in liked_ids}) for track in rotation
    ]


def _live_window(
    now: datetime,
    rotation: list[RadioTrack],
    anchor_epoch: float,
) -> tuple[int | None, int, datetime | None, datetime | None]:
    """Locate the current track in the station loop anchored at ``anchor_epoch``.

    The loop starts from track 0 at the anchor instant (the period handover),
    so track boundaries fall wherever the durations say — never at an
    arbitrary modulus of the raw epoch.
    """
    if not rotation:
        return None, 0, None, None

    durations = [track.duration for track in rotation]
    loop_duration = sum(durations)
    if loop_duration <= 0:
        return None, 0, None, None

    loop_offset = int(now.timestamp() - anchor_epoch) % loop_duration
    cursor = 0
    for index, duration in enumerate(durations):
        next_cursor = cursor + duration
        if loop_offset < next_cursor:
            progress = loop_offset - cursor
            started_at = now - timedelta(seconds=progress)
            ends_at = started_at + timedelta(seconds=duration)
            return index, progress, started_at, ends_at
        cursor = next_cursor

    return 0, 0, now, now + timedelta(seconds=durations[0])


def _crossing_track_end(
    rotation: list[RadioTrack],
    anchor_epoch: float,
    boundary_epoch: float,
) -> float:
    """When the track playing at ``boundary_epoch`` (under this loop) ends.

    Returns the boundary itself when the loop is empty/degenerate or a track
    boundary happens to coincide with the period boundary.
    """
    durations = [track.duration for track in rotation]
    loop_duration = sum(durations)
    if loop_duration <= 0:
        return boundary_epoch
    offset = int(boundary_epoch - anchor_epoch) % loop_duration
    cursor = 0
    for duration in durations:
        next_cursor = cursor + duration
        if offset < next_cursor:
            return boundary_epoch + (next_cursor - offset)
        cursor = next_cursor
    return boundary_epoch


async def _station_clock(
    db: AsyncSession,
    station: stations.Station,
    limit: int,
    now: datetime,
) -> tuple[list[RadioTrack], float, list[RadioTrack] | None]:
    """Resolve the rotation and loop anchor governing this instant.

    Period handovers land on track boundaries: the first request of a new
    period pins an anchor at the moment the previous period's in-flight track
    ends. Until that instant the previous rotation keeps playing (grace
    window) and the new rotation's head is exposed as what's next. Without
    Redis this degrades to anchoring every period at its own start — a clean
    track start at each boundary, never a mid-song landing.

    Returns ``(rotation, anchor_epoch, upcoming)`` where ``rotation`` is the
    loop governing *now* and ``upcoming`` is the next rotation's head during a
    grace window (else None).
    """
    period_index = int(now.timestamp()) // ROTATION_PERIOD_SECONDS
    period_start = float(period_index * ROTATION_PERIOD_SECONDS)
    rotation = await _load_rotation(db, station, limit, now, period_index)
    if not rotation:
        return rotation, period_start, None

    anchor_ttl = 2 * ROTATION_PERIOD_SECONDS + ROTATION_CACHE_MARGIN_SECONDS
    prev_period = str(period_index - 1)
    prev_period_start = float((period_index - 1) * ROTATION_PERIOD_SECONDS)

    async def prev_period_anchor() -> float:
        # the previous period's anchor should already be pinned; if it is gone
        # (redis restart), fall back to that period's start.
        anchor = await get_period_anchor(
            station.slug, limit, prev_period, _value(prev_period_start), anchor_ttl
        )
        return prev_period_start if anchor is None else anchor

    async def compute_anchor() -> float:
        # only what was *actually airing* can hand over; a rebuilt guess of a
        # lost rotation can't, so an uncached previous period anchors here.
        prev_rotation = await peek_rotation(station.slug, limit, prev_period)
        if not prev_rotation:
            return period_start
        return _crossing_track_end(
            prev_rotation, await prev_period_anchor(), period_start
        )

    anchor = await get_period_anchor(
        station.slug, limit, str(period_index), compute_anchor, anchor_ttl
    )
    if anchor is None:
        return rotation, period_start, None

    if now.timestamp() < anchor:
        # grace window: the previous period's track is still finishing.
        prev_rotation = await peek_rotation(station.slug, limit, prev_period)
        if prev_rotation:
            return prev_rotation, await prev_period_anchor(), rotation
        # degraded (rotation evicted but anchor kept): start the new loop now.
        return rotation, period_start, None
    return rotation, anchor, None


def _value(value: float) -> Callable[[], Awaitable[float]]:
    """A compute callback that just returns ``value``."""

    async def compute() -> float:
        return value

    return compute


def _up_next(
    rotation: list[RadioTrack],
    current_index: int | None,
    upcoming: list[RadioTrack] | None,
) -> list[RadioTrack]:
    """Return the next few tracks after the current one.

    During a period-handover grace window the current track is the old
    rotation's last stand — what actually plays next is the head of the new
    rotation, so that's what gets shown.
    """
    if upcoming:
        return upcoming[:4]
    if current_index is None or not rotation:
        return []
    return [
        rotation[(current_index + offset) % len(rotation)]
        for offset in range(1, min(len(rotation), 5))
    ]


@router.get("/stations")
async def list_stations() -> StationsResponse:
    """List the current station lineup for the flip UI."""
    return StationsResponse(
        default_slug=stations.DEFAULT_STATION_SLUG,
        stations=[
            StationSummary(
                slug=station.slug,
                name=station.name,
                description=station.description,
                is_default=station.slug == stations.DEFAULT_STATION_SLUG,
                source_url=station.source_url,
            )
            for station in stations.STATIONS
        ],
    )


@router.get("/state")
@router.get("/state.json")
async def radio_state(
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(DEFAULT_ROTATION_SIZE, ge=1, le=MAX_ROTATION_SIZE),
    station: str | None = Query(None, description="station slug; omit for default"),
    session: AuthSession | None = Depends(get_optional_session),
) -> RadioStateResponse:
    """Return the live public radio state for a station.

    Stateless and deterministic per (station, day): every client gets the same
    current track for a given wall-clock time. Omitting ``station`` serves the
    default station, preserving the historical single-station contract.
    """
    resolved = stations.get_station(station)
    if resolved is None:
        raise HTTPException(status_code=404, detail=f"unknown station: {station}")

    now = datetime.now(UTC)
    raw_rotation, anchor, upcoming = await _station_clock(db, resolved, limit, now)
    rotation = await _with_liked_state(db, raw_rotation, session)
    current_index, progress, started_at, ends_at = _live_window(now, rotation, anchor)
    current = rotation[current_index] if current_index is not None else None

    # the rotation is still computed and still described even while a broadcast
    # preempts it — the loop is the clock, and it keeps running so that whatever
    # resumes afterwards lands where wall-clock time says it should.
    broadcast = await get_live_broadcast(resolved.live)

    return RadioStateResponse(
        station=resolved.name,
        station_slug=resolved.slug,
        generated_at=now.isoformat(),
        loop_duration_seconds=sum(track.duration for track in rotation),
        current_index=current_index,
        current_started_at=started_at.isoformat() if started_at else None,
        current_ends_at=ends_at.isoformat() if ends_at else None,
        progress_seconds=progress,
        current=current,
        up_next=_up_next(rotation, current_index, upcoming),
        rotation=rotation,
        live=(
            LiveBroadcastInfo(
                stream_url=broadcast.stream_url,
                kind=broadcast.kind,
                started_at=broadcast.started_at,
                artwork_url=broadcast.artwork_url,
            )
            if broadcast
            else None
        ),
    )
