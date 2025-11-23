"""Track detail and playback endpoints."""

from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal.auth import get_session
from backend.models import Artist, Track, TrackLike, get_db
from backend.schemas import TrackResponse
from backend.utilities.aggregations import get_like_counts

from .router import router


@router.get("/{track_id}")
async def get_track(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    session_id_cookie: Annotated[str | None, Cookie(alias="session_id")] = None,
) -> TrackResponse:
    """Get a specific track."""
    liked_track_ids: set[int] | None = None
    session_id = session_id_cookie or request.headers.get("authorization", "").replace(
        "Bearer ", ""
    )
    if (
        session_id
        and (auth_session := await get_session(session_id))
        and await db.scalar(
            select(TrackLike.track_id).where(
                TrackLike.user_did == auth_session.did, TrackLike.track_id == track_id
            )
        )
    ):
        liked_track_ids = {track_id}

    result = await db.execute(
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(Track.id == track_id)
    )
    track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    like_counts = await get_like_counts(db, [track_id])

    return await TrackResponse.from_track(
        track, liked_track_ids=liked_track_ids, like_counts=like_counts
    )


@router.post("/{track_id}/play")
async def increment_play_count(
    track_id: int, db: Annotated[AsyncSession, Depends(get_db)]
) -> dict:
    """Increment play count for a track (called after 30 seconds of playback)."""
    result = await db.execute(select(Track).where(Track.id == track_id))
    track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    track.play_count += 1
    await db.commit()

    return {"play_count": track.play_count}
