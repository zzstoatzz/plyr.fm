"""Track like/unlike endpoints."""

import asyncio
import logging
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import require_auth
from backend._internal.tasks import (
    schedule_pds_create_like,
    schedule_pds_delete_like,
)
from backend.models import Artist, Track, TrackLike, get_db
from backend.schemas import LikedResponse, TrackResponse
from backend.utilities.aggregations import get_comment_counts, get_like_counts

from .router import router

logger = logging.getLogger(__name__)


class LikedTracksResponse(BaseModel):
    """response for listing liked tracks."""

    tracks: list[TrackResponse]


class LikerInfo(BaseModel):
    """user who liked a track."""

    did: str
    handle: str
    display_name: str | None
    avatar_url: str | None
    liked_at: str


class TrackLikersResponse(BaseModel):
    """response for getting users who liked a track."""

    users: list[LikerInfo]
    count: int


@router.get("/liked")
async def list_liked_tracks(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> LikedTracksResponse:
    """List tracks liked by authenticated user (queried from local index)."""
    stmt = (
        select(Track)
        .join(TrackLike, TrackLike.track_id == Track.id)
        .join(Artist)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(TrackLike.user_did == auth_session.did)
        .order_by(TrackLike.created_at.desc())
    )

    result = await db.execute(stmt)
    tracks = result.scalars().all()

    liked_track_ids = {track.id for track in tracks}
    track_ids = [track.id for track in tracks]
    like_counts, comment_counts = await asyncio.gather(
        get_like_counts(db, track_ids),
        get_comment_counts(db, track_ids),
    )

    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                track,
                liked_track_ids=liked_track_ids,
                like_counts=like_counts,
                comment_counts=comment_counts,
            )
            for track in tracks
        ]
    )

    return LikedTracksResponse(tracks=track_responses)


@router.post("/{track_id}/like")
async def like_track(
    track_id: int,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
    session_id_cookie: Annotated[str | None, Cookie(alias="session_id")] = None,
) -> LikedResponse:
    """Like a track - stores in database immediately, creates ATProto record in background.

    The like is visible immediately in the UI. The ATProto record is created
    asynchronously via a background task, keeping the API response fast.
    """
    result = await db.execute(select(Track).where(Track.id == track_id))
    track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    if not track.atproto_record_uri or not track.atproto_record_cid:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "missing_atproto_record",
                "message": "this track cannot be liked because its ATProto record is missing",
            },
        )

    existing_like = await db.execute(
        select(TrackLike).where(
            TrackLike.track_id == track_id, TrackLike.user_did == auth_session.did
        )
    )
    if existing_like.scalar_one_or_none():
        return LikedResponse(liked=True)

    # create database record immediately (optimistic)
    like = TrackLike(
        track_id=track_id,
        user_did=auth_session.did,
        atproto_like_uri=None,  # will be set by background task
    )
    db.add(like)
    await db.commit()
    await db.refresh(like)

    # schedule PDS record creation in background
    session_id = session_id_cookie or request.headers.get("authorization", "").replace(
        "Bearer ", ""
    )
    await schedule_pds_create_like(
        session_id=session_id,
        like_id=like.id,
        subject_uri=track.atproto_record_uri,
        subject_cid=track.atproto_record_cid,
    )

    return LikedResponse(liked=True)


@router.delete("/{track_id}/like")
async def unlike_track(
    track_id: int,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
    session_id_cookie: Annotated[str | None, Cookie(alias="session_id")] = None,
) -> LikedResponse:
    """Unlike a track - removes from database immediately, deletes ATProto record in background.

    The unlike is reflected immediately in the UI. The ATProto record deletion
    happens asynchronously via a background task.
    """
    result = await db.execute(
        select(TrackLike).where(
            TrackLike.track_id == track_id, TrackLike.user_did == auth_session.did
        )
    )
    like = result.scalar_one_or_none()

    if not like:
        return LikedResponse(liked=False)

    # capture the ATProto URI before deleting the DB record
    like_uri = like.atproto_like_uri

    # delete database record immediately (optimistic)
    await db.delete(like)
    await db.commit()

    # schedule PDS record deletion in background (if URI exists)
    if like_uri:
        session_id = session_id_cookie or request.headers.get(
            "authorization", ""
        ).replace("Bearer ", "")
        await schedule_pds_delete_like(
            session_id=session_id,
            like_uri=like_uri,
        )

    return LikedResponse(liked=False)


@router.get("/{track_id}/likes")
async def get_track_likes(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TrackLikersResponse:
    """Public endpoint returning users who liked a track.

    Returns a list of user display info (handle, display name, avatar, liked_at
    timestamp). This endpoint is public—no authentication required to see who
    liked a track.
    """
    track_exists = await db.scalar(select(Track.id).where(Track.id == track_id))
    if not track_exists:
        raise HTTPException(status_code=404, detail="track not found")

    stmt = (
        select(TrackLike, Artist)
        .join(Artist, Artist.did == TrackLike.user_did)
        .where(TrackLike.track_id == track_id)
        .order_by(TrackLike.created_at.desc())
    )

    result = await db.execute(stmt)
    likes_with_artists = result.all()

    users = [
        LikerInfo(
            did=artist.did,
            handle=artist.handle,
            display_name=artist.display_name,
            avatar_url=artist.avatar_url,
            liked_at=like.created_at.isoformat(),
        )
        for like, artist in likes_with_artists
    ]

    return TrackLikersResponse(users=users, count=len(users))
