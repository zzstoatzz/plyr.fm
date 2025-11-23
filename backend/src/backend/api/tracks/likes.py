"""Track like/unlike endpoints."""

import asyncio
import logging
from typing import Annotated

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import require_auth
from backend._internal.atproto import create_like_record, delete_record_by_uri
from backend.models import Artist, Track, TrackLike, get_db
from backend.schemas import TrackResponse
from backend.utilities.aggregations import get_like_counts

from .router import router

logger = logging.getLogger(__name__)


@router.get("/liked")
async def list_liked_tracks(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> dict:
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
    like_counts = await get_like_counts(db, track_ids)

    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                track, liked_track_ids=liked_track_ids, like_counts=like_counts
            )
            for track in tracks
        ]
    )

    return {"tracks": track_responses}


@router.post("/{track_id}/like")
async def like_track(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> dict:
    """Like a track - creates ATProto record and stores in index."""
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
        return {"liked": True}

    like_uri = None
    try:
        like_uri = await create_like_record(
            auth_session=auth_session,
            subject_uri=track.atproto_record_uri,
            subject_cid=track.atproto_record_cid,
        )

        like = TrackLike(
            track_id=track_id,
            user_did=auth_session.did,
            atproto_like_uri=like_uri,
        )
        db.add(like)
        await db.commit()
    except Exception as e:
        logger.error(
            f"failed to like track {track_id} for user {auth_session.did}: {e}",
            exc_info=True,
        )
        if like_uri:
            try:
                await delete_record_by_uri(
                    auth_session=auth_session,
                    record_uri=like_uri,
                )
                logger.info(f"cleaned up orphaned ATProto like record: {like_uri}")
            except Exception as cleanup_exc:
                logger.error(
                    f"failed to clean up orphaned ATProto like record {like_uri}: {cleanup_exc}"
                )
        raise HTTPException(
            status_code=500, detail="failed to like track - please try again"
        ) from e

    return {"liked": True, "atproto_uri": like_uri}


@router.delete("/{track_id}/like")
async def unlike_track(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> dict:
    """Unlike a track - deletes ATProto record and removes from index."""
    result = await db.execute(
        select(TrackLike).where(
            TrackLike.track_id == track_id, TrackLike.user_did == auth_session.did
        )
    )
    like = result.scalar_one_or_none()

    if not like:
        return {"liked": False}

    track_result = await db.execute(select(Track).where(Track.id == track_id))
    track = track_result.scalar_one_or_none()
    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    if not track.atproto_record_uri or not track.atproto_record_cid:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "missing_atproto_record",
                "message": "this track cannot be unliked because its ATProto record is missing",
            },
        )

    await delete_record_by_uri(
        auth_session=auth_session,
        record_uri=like.atproto_like_uri,
    )

    await db.delete(like)
    try:
        await db.commit()
    except Exception as e:
        logger.error(
            f"failed to commit unlike to database after deleting ATProto record: {e}"
        )
        try:
            recreated_uri = await create_like_record(
                auth_session=auth_session,
                subject_uri=track.atproto_record_uri,
                subject_cid=track.atproto_record_cid,
            )
            logger.info(
                f"rolled back ATProto deletion by recreating like: {recreated_uri}"
            )
        except Exception as rollback_exc:
            logger.critical(
                f"failed to rollback ATProto deletion for track {track_id}, "
                f"user {auth_session.did}: {rollback_exc}. "
                "database and ATProto are now inconsistent"
            )
        raise HTTPException(
            status_code=500, detail="failed to unlike track - please try again"
        ) from e

    return {"liked": False}


@router.get("/{track_id}/likes")
async def get_track_likes(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
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
        {
            "did": artist.did,
            "handle": artist.handle,
            "display_name": artist.display_name,
            "avatar_url": artist.avatar_url,
            "liked_at": like.created_at.isoformat(),
        }
        for like, artist in likes_with_artists
    ]

    return {"users": users, "count": len(users)}
