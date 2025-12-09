"""Track detail and playback endpoints."""

import asyncio
import logging
from typing import Annotated

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session, get_optional_session
from backend._internal.background_tasks import schedule_teal_scrobble
from backend.config import settings
from backend.models import Artist, Track, TrackLike, UserPreferences, get_db
from backend.schemas import TrackResponse
from backend.utilities.aggregations import get_like_counts, get_track_tags

from .router import router

logger = logging.getLogger(__name__)


@router.get("/{track_id}")
async def get_track(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session | None = Depends(get_optional_session),
) -> TrackResponse:
    """Get a specific track."""
    liked_track_ids: set[int] | None = None
    if session and await db.scalar(
        select(TrackLike.track_id).where(
            TrackLike.user_did == session.did, TrackLike.track_id == track_id
        )
    ):
        liked_track_ids = {track_id}

    result = await db.execute(
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(Track.id == track_id)
    )
    if not (track := result.scalar_one_or_none()):
        raise HTTPException(status_code=404, detail="track not found")

    like_counts, track_tags = await asyncio.gather(
        get_like_counts(db, [track_id]),
        get_track_tags(db, [track_id]),
    )

    return await TrackResponse.from_track(
        track,
        liked_track_ids=liked_track_ids,
        like_counts=like_counts,
        track_tags=track_tags,
    )


@router.post("/{track_id}/play")
async def increment_play_count(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session | None = Depends(get_optional_session),
) -> dict:
    """Increment play count for a track (called after 30 seconds of playback).

    If user has teal.fm scrobbling enabled and has the required scopes,
    also writes play record to their PDS.
    """
    # load track with artist info
    result = await db.execute(
        select(Track)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(Track.id == track_id)
    )

    if not (track := result.scalar_one_or_none()):
        raise HTTPException(status_code=404, detail="track not found")

    track.play_count += 1
    await db.commit()

    # check if user wants teal scrobbling
    if session:
        prefs = await db.scalar(
            select(UserPreferences).where(UserPreferences.did == session.did)
        )
        if prefs and prefs.enable_teal_scrobbling:
            # check if session has teal scopes
            scope = session.oauth_session.get("scope", "")
            if settings.teal.play_collection in scope:
                await schedule_teal_scrobble(
                    session_id=session.session_id,
                    track_id=track_id,
                    track_title=track.title,
                    artist_name=track.artist.display_name or track.artist.handle,
                    duration=track.duration,
                    album_name=track.album_rel.title if track.album_rel else None,
                )

    return {"play_count": track.play_count}
