"""user-related public endpoints."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session, get_optional_session
from backend.models import Artist, Track, TrackLike, get_db
from backend.schemas import TrackResponse
from backend.utilities.aggregations import get_comment_counts, get_like_counts

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/{handle}/likes")
async def get_user_liked_tracks(
    handle: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session | None = Depends(get_optional_session),
) -> dict:
    """get tracks liked by a user (public).

    likes are stored on the user's PDS as ATProto records, making them
    public data. this endpoint returns the indexed likes for any user.
    """
    # resolve handle to DID
    result = await db.execute(select(Artist).where(Artist.handle == handle))
    artist = result.scalar_one_or_none()

    if not artist:
        raise HTTPException(status_code=404, detail="user not found")

    # get tracks liked by this user
    stmt = (
        select(Track)
        .join(TrackLike, TrackLike.track_id == Track.id)
        .join(Artist, Artist.did == Track.artist_did)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(TrackLike.user_did == artist.did)
        .order_by(TrackLike.created_at.desc())
    )

    track_result = await db.execute(stmt)
    tracks = track_result.scalars().all()

    # get current user's liked track IDs if authenticated
    liked_track_ids: set[int] = set()
    if session:
        liked_stmt = select(TrackLike.track_id).where(TrackLike.user_did == session.did)
        liked_result = await db.execute(liked_stmt)
        liked_track_ids = set(liked_result.scalars().all())

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

    # get total like count for this user
    count_stmt = (
        select(func.count())
        .select_from(TrackLike)
        .where(TrackLike.user_did == artist.did)
    )
    total_count = await db.scalar(count_stmt)

    return {
        "user": {
            "did": artist.did,
            "handle": artist.handle,
            "display_name": artist.display_name,
            "avatar_url": artist.avatar_url,
        },
        "tracks": track_responses,
        "count": total_count or 0,
    }
