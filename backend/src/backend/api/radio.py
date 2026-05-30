"""Public live radio state for simple clients and games."""

import hashlib
import math
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend.models import Artist, Track, get_db
from backend.utilities.aggregations import get_like_counts, get_track_tags

router = APIRouter(prefix="/radio", tags=["radio"])

DEFAULT_TRACK_SECONDS = 180
DEFAULT_ROTATION_SIZE = 40
MAX_ROTATION_SIZE = 75
SOURCE_CANDIDATE_LIMIT = 500
DAILY_VARIETY_WEIGHT = 0.75


class RadioTrack(BaseModel):
    """Small public track shape for radio clients."""

    id: int
    title: str
    artist: str
    artist_handle: str
    artist_did: str
    stream_url: str
    file_type: str
    duration: int
    artwork_url: str | None
    thumbnail_url: str | None
    atproto_record_uri: str | None
    created_at: str
    tags: list[str]
    like_count: int
    play_count: int


class RadioStateResponse(BaseModel):
    """Live radio state response."""

    station: str
    generated_at: str
    loop_duration_seconds: int
    current_index: int | None
    current_started_at: str | None
    current_ends_at: str | None
    progress_seconds: int
    current: RadioTrack | None
    up_next: list[RadioTrack]
    rotation: list[RadioTrack]


def _stream_url(request: Request, track: Track) -> str:
    """Return the existing audio redirect endpoint as an absolute URL."""
    return str(request.url_for("stream_audio", file_id=track.file_id))


def _duration_seconds(track: Track) -> int:
    """Return a usable duration for scheduling."""
    if track.duration and track.duration > 0:
        return int(track.duration)
    return DEFAULT_TRACK_SECONDS


def _score_track(track: Track, like_count: int) -> float:
    """Rank tracks for the station rotation.

    Likes are explicit taste signals. Plays are weaker implicit signals and are
    log-scaled so old high-volume tracks do not permanently swallow the station.
    """
    return (like_count * 3) + math.log1p(track.play_count)


def _daily_variety(track: Track, now: datetime) -> float:
    """Stable daily jitter so the station is weighted, not a hard top-N chart."""
    day = now.date().isoformat()
    digest = hashlib.blake2s(f"{day}:{track.id}".encode(), digest_size=4).digest()
    return int.from_bytes(digest, "big") / 2**32


async def _rotation_tracks(db: AsyncSession, limit: int) -> list[Track]:
    """Build the public radio rotation from catalog signals."""
    now = datetime.now(UTC)
    stmt = (
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist))
        .where(
            Track.unlisted == False,  # noqa: E712
            Track.support_gate.is_(None),
        )
        .order_by(Track.created_at.desc(), Track.id.desc())
        .limit(SOURCE_CANDIDATE_LIMIT)
    )
    result = await db.execute(stmt)
    candidates = list(result.scalars().all())
    if not candidates:
        return []

    like_counts = await get_like_counts(db, [track.id for track in candidates])
    ranked = sorted(
        candidates,
        key=lambda track: (
            _score_track(track, like_counts.get(track.id, 0))
            + (_daily_variety(track, now) * DAILY_VARIETY_WEIGHT),
            track.created_at,
            track.id,
        ),
        reverse=True,
    )
    return ranked[:limit]


async def _to_radio_tracks(
    request: Request,
    db: AsyncSession,
    tracks: list[Track],
) -> list[RadioTrack]:
    """Serialize tracks for public radio consumers."""
    track_ids = [track.id for track in tracks]
    like_counts = await get_like_counts(db, track_ids)
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


@router.get("/state")
@router.get("/state.json")
async def radio_state(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(DEFAULT_ROTATION_SIZE, ge=1, le=MAX_ROTATION_SIZE),
) -> RadioStateResponse:
    """Return the live public radio state.

    The MVP station is stateless and deterministic: every client gets the same
    current track for a given wall-clock time. Rotation order is selected from
    public, ungated tracks using likes plus log-scaled play counts.
    """
    now = datetime.now(UTC)
    tracks = await _rotation_tracks(db, limit)
    rotation = await _to_radio_tracks(request, db, tracks)
    current_index, progress, started_at, ends_at = _live_window(now, rotation)
    current = rotation[current_index] if current_index is not None else None

    return RadioStateResponse(
        station="plyr.fm radio",
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
