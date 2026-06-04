"""Public live radio state for simple clients and games.

The response is a stateless, deterministic wall-clock loop: every client gets the
same current track for a given instant, per station. Station selection (which
tracks, in what order) lives in ``corpus`` / ``lenses`` / ``sampler``; this module
owns only the HTTP surface and the loop arithmetic.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.radio import stations
from backend.api.radio.corpus import load_corpus
from backend.api.radio.lenses import LensContext
from backend.api.radio.router import router
from backend.api.radio.sampler import build_rotation
from backend.api.radio.schemas import (
    RadioStateResponse,
    RadioTrack,
    StationsResponse,
    StationSummary,
)
from backend.models import Track, get_db
from backend.utilities.aggregations import get_like_counts, get_track_tags

DEFAULT_TRACK_SECONDS = 180
DEFAULT_ROTATION_SIZE = 40
MAX_ROTATION_SIZE = 75


def _stream_url(request: Request, track: Track) -> str:
    """Return the existing audio redirect endpoint as an absolute URL."""
    return str(request.url_for("stream_audio", file_id=track.file_id))


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
    eligible = [t for t in corpus if station.corpus_filter(tag_map.get(t.id, set()))]
    if not eligible:
        return [], {}

    like_counts = await get_like_counts(db, [track.id for track in eligible])
    # eligible keeps the newest-first corpus order, so enumeration is the recency
    # rank within this station's pool.
    recency_rank = {track.id: rank for rank, track in enumerate(eligible)}
    ctx = LensContext(like_counts=like_counts, now=now, recency_rank=recency_rank)
    weights = {track.id: station.lens(track, ctx) for track in eligible}
    rotation = build_rotation(
        eligible,
        weights,
        station_slug=station.slug,
        day=now.date().isoformat(),
        max_tracks=limit,
    )
    return rotation, like_counts


async def _to_radio_tracks(
    request: Request,
    db: AsyncSession,
    tracks: list[Track],
    like_counts: dict[int, int],
) -> list[RadioTrack]:
    """Serialize tracks for public radio consumers."""
    track_ids = [track.id for track in tracks]
    tag_map = await get_track_tags(db, track_ids)
    return [
        RadioTrack(
            id=track.id,
            title=track.title,
            artist=track.artist.display_name,
            artist_handle=track.artist.handle,
            artist_did=track.artist_did,
            stream_url=_stream_url(request, track),
            file_type=track.file_type,
            duration=_duration_seconds(track),
            artwork_url=track.image_url or track.artist.avatar_url,
            thumbnail_url=track.thumbnail_url,
            atproto_record_uri=track.atproto_record_uri,
            created_at=track.created_at.isoformat(),
            tags=sorted(tag_map.get(track.id, set())),
            like_count=like_counts.get(track.id, 0),
            play_count=track.play_count,
        )
        for track in tracks
    ]


def _live_window(
    now: datetime,
    rotation: list[RadioTrack],
) -> tuple[int | None, int, datetime | None, datetime | None]:
    """Locate the current track in the deterministic station loop."""
    if not rotation:
        return None, 0, None, None

    durations = [track.duration for track in rotation]
    loop_duration = sum(durations)
    if loop_duration <= 0:
        return None, 0, None, None

    epoch_seconds = int(now.timestamp())
    loop_offset = epoch_seconds % loop_duration
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


def _up_next(rotation: list[RadioTrack], current_index: int | None) -> list[RadioTrack]:
    """Return the next few tracks after the current one."""
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
            )
            for station in stations.STATIONS
        ],
    )


@router.get("/state")
@router.get("/state.json")
async def radio_state(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(DEFAULT_ROTATION_SIZE, ge=1, le=MAX_ROTATION_SIZE),
    station: str | None = Query(None, description="station slug; omit for default"),
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
    tracks, like_counts = await _select_rotation(db, resolved, limit, now)
    rotation = await _to_radio_tracks(request, db, tracks, like_counts)
    current_index, progress, started_at, ends_at = _live_window(now, rotation)
    current = rotation[current_index] if current_index is not None else None

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
        up_next=_up_next(rotation, current_index),
        rotation=rotation,
    )
