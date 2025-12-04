"""Track detail and playback endpoints."""

import logging
from typing import Annotated

from fastapi import BackgroundTasks, Cookie, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal.auth import get_session
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
    track_tags = await get_track_tags(db, [track_id])

    return await TrackResponse.from_track(
        track,
        liked_track_ids=liked_track_ids,
        like_counts=like_counts,
        track_tags=track_tags,
    )


async def _scrobble_to_teal(
    session_id: str,
    track_id: int,
    track_title: str,
    artist_name: str,
    duration: int | None,
    album_name: str | None,
) -> None:
    """background task to scrobble a play to teal.fm."""
    from backend._internal.atproto.teal import (
        create_teal_play_record,
        update_teal_status,
    )

    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"teal scrobble failed: session {session_id[:8]}... not found")
        return

    origin_url = f"https://plyr.fm/track/{track_id}"

    try:
        # create play record (scrobble)
        play_uri = await create_teal_play_record(
            auth_session=auth_session,
            track_name=track_title,
            artist_name=artist_name,
            duration=duration,
            album_name=album_name,
            origin_url=origin_url,
        )
        logger.info(f"teal play record created: {play_uri}")

        # update status (now playing)
        status_uri = await update_teal_status(
            auth_session=auth_session,
            track_name=track_title,
            artist_name=artist_name,
            duration=duration,
            album_name=album_name,
            origin_url=origin_url,
        )
        logger.info(f"teal status updated: {status_uri}")

    except Exception as e:
        logger.error(f"teal scrobble failed for track {track_id}: {e}", exc_info=True)


@router.post("/{track_id}/play")
async def increment_play_count(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    background_tasks: BackgroundTasks,
    session_id_cookie: Annotated[str | None, Cookie(alias="session_id")] = None,
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
    track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    track.play_count += 1
    await db.commit()

    # check if user wants teal scrobbling
    session_id = session_id_cookie or request.headers.get("authorization", "").replace(
        "Bearer ", ""
    )

    if session_id:
        auth_session = await get_session(session_id)
        if auth_session:
            # check preferences
            prefs_result = await db.execute(
                select(UserPreferences).where(UserPreferences.did == auth_session.did)
            )
            prefs = prefs_result.scalar_one_or_none()

            if prefs and prefs.enable_teal_scrobbling:
                # check if session has teal scopes
                scope = auth_session.oauth_session.get("scope", "")
                if settings.atproto.teal_play_collection in scope:
                    # scrobble in background
                    background_tasks.add_task(
                        _scrobble_to_teal,
                        session_id=session_id,
                        track_id=track_id,
                        track_title=track.title,
                        artist_name=track.artist.display_name or track.artist.handle,
                        duration=track.duration,
                        album_name=track.album_rel.title if track.album_rel else None,
                    )

    return {"play_count": track.play_count}
