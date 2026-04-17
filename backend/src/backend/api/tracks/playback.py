"""Track detail and playback endpoints."""

import asyncio
import logging
from typing import Annotated

from atproto_oauth.scopes import ScopesSet
from fastapi import Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session, get_optional_session
from backend._internal.tasks import schedule_teal_scrobble
from backend.config import settings
from backend.models import (
    Artist,
    ShareLink,
    ShareLinkEvent,
    Track,
    TrackLike,
    UserPreferences,
    get_db,
)
from backend.schemas import PlayCountResponse, TrackResponse
from backend.utilities.aggregations import (
    get_like_counts,
    get_top_likers,
    get_track_tags,
)

from .router import router

logger = logging.getLogger(__name__)


class PlayRequest(BaseModel):
    """optional request body for play endpoint."""

    ref: str | None = None


async def _resolve_track(
    db: AsyncSession,
    track: Track,
    session: Session | None,
) -> TrackResponse:
    """build a TrackResponse with likes, tags, etc."""
    liked_track_ids: set[int] | None = None
    if session and await db.scalar(
        select(TrackLike.track_id).where(
            TrackLike.user_did == session.did, TrackLike.track_id == track.id
        )
    ):
        liked_track_ids = {track.id}

    like_counts, track_tags, top_likers = await asyncio.gather(
        get_like_counts(db, [track.id]),
        get_track_tags(db, [track.id]),
        get_top_likers(db, [track.id]),
    )

    return await TrackResponse.from_track(
        track,
        liked_track_ids=liked_track_ids,
        like_counts=like_counts,
        track_tags=track_tags,
        top_likers=top_likers,
    )


@router.get("/by-uri")
async def get_track_by_uri(
    uri: Annotated[str, Query(description="AT-URI of the track record")],
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session | None = Depends(get_optional_session),
) -> TrackResponse:
    """Get a track by its ATProto record URI."""
    result = await db.execute(
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(Track.atproto_record_uri == uri)
    )
    if not (track := result.scalar_one_or_none()):
        raise HTTPException(status_code=404, detail="track not found")

    return await _resolve_track(db, track, session)


@router.get("/{track_id}")
async def get_track(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session | None = Depends(get_optional_session),
) -> TrackResponse:
    """Get a specific track."""
    result = await db.execute(
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(Track.id == track_id)
    )
    if not (track := result.scalar_one_or_none()):
        raise HTTPException(status_code=404, detail="track not found")

    return await _resolve_track(db, track, session)


@router.post("/{track_id}/play")
async def increment_play_count(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session | None = Depends(get_optional_session),
    body: PlayRequest | None = Body(default=None),
) -> PlayCountResponse:
    """Increment play count for a track (called after 30 seconds of playback).

    If user has teal.fm scrobbling enabled and has the required scopes,
    also writes play record to their PDS.

    If a ref code is provided, also records a play event for share link tracking.
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

    # record share link play event if ref provided
    ref = body.ref if body else None
    if ref:
        share_link = await db.scalar(
            select(ShareLink).where(
                ShareLink.code == ref, ShareLink.track_id == track_id
            )
        )
        if share_link:
            visitor_did = session.did if session else None
            # skip self-plays (creator playing their own shared link)
            if not (visitor_did and visitor_did == share_link.creator_did):
                event = ShareLinkEvent(
                    share_link_id=share_link.id,
                    visitor_did=visitor_did,
                    event_type="play",
                )
                db.add(event)

    await db.commit()

    # check if user wants teal scrobbling
    if session:
        prefs = await db.scalar(
            select(UserPreferences).where(UserPreferences.did == session.did)
        )
        if prefs and prefs.enable_teal_scrobbling:
            # check if session has teal scopes
            scopes = ScopesSet.from_string(session.oauth_session.get("scope", ""))
            if scopes.matches(
                "repo",
                collection=settings.teal.play_collection,
                action="create",
            ):
                await schedule_teal_scrobble(
                    session_id=session.session_id,
                    track_id=track_id,
                    track_title=track.title,
                    artist_name=track.artist.display_name or track.artist.handle,
                    duration=track.duration,
                    album_name=track.album_rel.title if track.album_rel else None,
                )

    return PlayCountResponse(play_count=track.play_count)
