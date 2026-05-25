"""Track detail and playback endpoints."""

import asyncio
import logging
import secrets
from typing import Annotated

import logfire
from atproto_oauth.scopes import ScopesSet
from fastapi import Body, Depends, HTTPException, Query, Request, Response
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
from backend.utilities.aggregations import get_like_counts, get_track_tags
from backend.utilities.redis import get_async_redis_client

from .router import router

logger = logging.getLogger(__name__)

# play-count dedup: a listener can only add one counted play per track within
# roughly one track-length — you cannot genuinely finish the same track twice
# inside its own duration. anonymous listeners key on a first-party cookie.
_PLAY_ID_COOKIE = "plyr_play_id"
_PLAY_DEDUP_MIN_TTL_S = 30
_PLAY_DEDUP_MAX_TTL_S = 60 * 60
_PLAY_DEDUP_DEFAULT_TTL_S = 5 * 60


class PlayRequest(BaseModel):
    """optional request body for play endpoint."""

    ref: str | None = None


def _listener_key(request: Request, response: Response, session: Session | None) -> str:
    """stable per-listener key for play-count dedup.

    authenticated listeners key on their DID; anonymous listeners key on a
    long-lived first-party cookie (best-effort — a cleared cookie counts again).
    """
    if session:
        return f"did:{session.did}"
    if anon_id := request.cookies.get(_PLAY_ID_COOKIE):
        return f"anon:{anon_id}"
    anon_id = secrets.token_urlsafe(16)
    is_localhost = bool(settings.frontend.url) and settings.frontend.url.startswith(
        "http://localhost"
    )
    response.set_cookie(
        key=_PLAY_ID_COOKIE,
        value=anon_id,
        httponly=True,
        secure=not is_localhost,
        samesite="lax",
        max_age=180 * 24 * 60 * 60,
    )
    return f"anon:{anon_id}"


async def _claim_play(listener_key: str, track_id: int, ttl_seconds: int) -> bool:
    """claim a play for (listener, track), allowing one per ``ttl_seconds`` window.

    fails open (counts the play) when redis is unavailable so play counting never
    hard-depends on the cache.
    """
    try:
        claimed = await get_async_redis_client().set(
            f"play-count:{listener_key}:{track_id}", "1", nx=True, ex=ttl_seconds
        )
    except Exception as exc:
        logfire.warning(
            "play-count dedup unavailable; counting play",
            track_id=track_id,
            error=str(exc),
        )
        return True
    return bool(claimed)


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

    like_counts, track_tags = await asyncio.gather(
        get_like_counts(db, [track.id]),
        get_track_tags(db, [track.id]),
    )

    return await TrackResponse.from_track(
        track,
        liked_track_ids=liked_track_ids,
        like_counts=like_counts,
        track_tags=track_tags,
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
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session | None = Depends(get_optional_session),
    body: PlayRequest | None = Body(default=None),
) -> PlayCountResponse:
    """Increment play count for a track (called after sustained playback).

    Deduplicated per listener per track for roughly one track-length, so
    refreshing other tabs (or replaying the same position) does not inflate the
    count while genuine repeat listens still count.

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

    ttl = max(
        _PLAY_DEDUP_MIN_TTL_S,
        min(track.duration or _PLAY_DEDUP_DEFAULT_TTL_S, _PLAY_DEDUP_MAX_TTL_S),
    )
    if not await _claim_play(_listener_key(request, response, session), track_id, ttl):
        logfire.info("play count deduped", track_id=track_id)
        return PlayCountResponse(play_count=track.play_count)

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
