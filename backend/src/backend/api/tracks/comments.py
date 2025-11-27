"""Track timed comments endpoints."""

import logging
from typing import Annotated

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session as AuthSession
from backend._internal import require_auth
from backend._internal.atproto import create_comment_record, delete_record_by_uri
from backend.models import Artist, Track, TrackComment, UserPreferences, get_db

from .router import router

logger = logging.getLogger(__name__)

# max comments per track (configurable via settings later)
MAX_COMMENTS_PER_TRACK = 20


class CommentCreate(BaseModel):
    """request body for creating a comment."""

    text: str = Field(..., min_length=1, max_length=300)
    timestamp_ms: int = Field(..., ge=0)


class CommentResponse(BaseModel):
    """response model for a single comment."""

    id: int
    user_did: str
    user_handle: str
    user_display_name: str | None
    user_avatar_url: str | None
    text: str
    timestamp_ms: int
    created_at: str


class CommentsListResponse(BaseModel):
    """response model for list of comments."""

    comments: list[CommentResponse]
    count: int
    comments_enabled: bool


@router.get("/{track_id}/comments")
async def get_track_comments(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CommentsListResponse:
    """get all comments for a track, ordered by timestamp.

    public endpoint - no auth required.
    """
    # check track exists and get artist's allow_comments setting
    track_result = await db.execute(select(Track).where(Track.id == track_id))
    track = track_result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    # check if artist allows comments
    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.did == track.artist_did)
    )
    prefs = prefs_result.scalar_one_or_none()
    comments_enabled = prefs.allow_comments if prefs else False

    if not comments_enabled:
        return CommentsListResponse(comments=[], count=0, comments_enabled=False)

    # fetch comments with user info
    stmt = (
        select(TrackComment, Artist)
        .outerjoin(Artist, Artist.did == TrackComment.user_did)
        .where(TrackComment.track_id == track_id)
        .order_by(TrackComment.timestamp_ms)
    )
    result = await db.execute(stmt)
    rows = result.all()

    comments = [
        CommentResponse(
            id=comment.id,
            user_did=comment.user_did,
            user_handle=artist.handle if artist else comment.user_did,
            user_display_name=artist.display_name if artist else None,
            user_avatar_url=artist.avatar_url if artist else None,
            text=comment.text,
            timestamp_ms=comment.timestamp_ms,
            created_at=comment.created_at.isoformat(),
        )
        for comment, artist in rows
    ]

    return CommentsListResponse(
        comments=comments, count=len(comments), comments_enabled=True
    )


@router.post("/{track_id}/comments")
async def create_comment(
    track_id: int,
    body: CommentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> CommentResponse:
    """create a timed comment on a track.

    requires auth. track owner must have allow_comments enabled.
    """
    # get track
    track_result = await db.execute(select(Track).where(Track.id == track_id))
    track = track_result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    if not track.atproto_record_uri or not track.atproto_record_cid:
        raise HTTPException(
            status_code=422,
            detail="track missing ATProto record - cannot comment",
        )

    # check if artist allows comments
    prefs_result = await db.execute(
        select(UserPreferences).where(UserPreferences.did == track.artist_did)
    )
    prefs = prefs_result.scalar_one_or_none()

    if not prefs or not prefs.allow_comments:
        raise HTTPException(
            status_code=403,
            detail="comments are disabled for this artist's tracks",
        )

    # check comment limit
    count_result = await db.execute(
        select(func.count()).where(TrackComment.track_id == track_id)
    )
    comment_count = count_result.scalar() or 0

    if comment_count >= MAX_COMMENTS_PER_TRACK:
        raise HTTPException(
            status_code=400,
            detail=f"track has reached maximum of {MAX_COMMENTS_PER_TRACK} comments",
        )

    # create ATProto record
    comment_uri = None
    try:
        comment_uri = await create_comment_record(
            auth_session=auth_session,
            subject_uri=track.atproto_record_uri,
            subject_cid=track.atproto_record_cid,
            text=body.text,
            timestamp_ms=body.timestamp_ms,
        )

        # create database record
        comment = TrackComment(
            track_id=track_id,
            user_did=auth_session.did,
            text=body.text,
            timestamp_ms=body.timestamp_ms,
            atproto_comment_uri=comment_uri,
        )
        db.add(comment)
        await db.commit()
        await db.refresh(comment)

    except Exception as e:
        await db.rollback()
        logger.error(
            f"failed to create comment on track {track_id} by {auth_session.did}: {e}",
            exc_info=True,
        )
        # cleanup ATProto record if created
        if comment_uri:
            try:
                await delete_record_by_uri(auth_session, comment_uri)
                logger.info(
                    f"cleaned up orphaned ATProto comment record: {comment_uri}"
                )
            except Exception as cleanup_exc:
                logger.error(
                    f"failed to cleanup orphaned comment record: {cleanup_exc}"
                )
        raise HTTPException(status_code=500, detail="failed to create comment") from e

    # get user info for response
    artist_result = await db.execute(
        select(Artist).where(Artist.did == auth_session.did)
    )
    artist = artist_result.scalar_one_or_none()

    return CommentResponse(
        id=comment.id,
        user_did=comment.user_did,
        user_handle=artist.handle if artist else auth_session.did,
        user_display_name=artist.display_name if artist else None,
        user_avatar_url=artist.avatar_url if artist else None,
        text=comment.text,
        timestamp_ms=comment.timestamp_ms,
        created_at=comment.created_at.isoformat(),
    )


@router.delete("/comments/{comment_id}")
async def delete_comment(
    comment_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> dict:
    """delete a comment. only the author can delete their own comments."""
    comment_result = await db.execute(
        select(TrackComment).where(TrackComment.id == comment_id)
    )
    comment = comment_result.scalar_one_or_none()

    if not comment:
        raise HTTPException(status_code=404, detail="comment not found")

    if comment.user_did != auth_session.did:
        raise HTTPException(status_code=403, detail="can only delete your own comments")

    # delete ATProto record
    try:
        await delete_record_by_uri(auth_session, comment.atproto_comment_uri)
    except Exception as e:
        logger.error(f"failed to delete ATProto comment record: {e}")
        # continue with DB deletion anyway

    await db.delete(comment)
    await db.commit()

    return {"deleted": True}
