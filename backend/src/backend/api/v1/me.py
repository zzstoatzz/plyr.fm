"""v1 API - authenticated user endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal.auth import AuthContext, require_auth_v1
from backend.api.v1.tracks import AlbumRef, ArtistRef, TrackListResponse, TrackResponse
from backend.models import Artist, Track, TrackComment, TrackLike, get_db

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/tracks", response_model=TrackListResponse)
async def list_my_tracks(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth: Annotated[AuthContext, Depends(require_auth_v1)],
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
) -> TrackListResponse:
    """list tracks owned by authenticated user.

    requires authentication via API key or session.
    """
    result = await db.execute(
        select(Track)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .join(Artist, Track.artist_did == Artist.did)
        .where(Track.artist_did == auth.did)
        .order_by(Track.created_at.desc())
        .limit(limit)
    )
    tracks = list(result.scalars().all())

    # get like counts and comment counts
    track_ids = [t.id for t in tracks]
    like_counts: dict[int, int] = {}
    comment_counts: dict[int, int] = {}
    if track_ids:
        like_result = await db.execute(
            select(TrackLike.track_id, func.count(TrackLike.id))
            .where(TrackLike.track_id.in_(track_ids))
            .group_by(TrackLike.track_id)
        )
        like_counts = {row[0]: row[1] for row in like_result.all()}

        comment_result = await db.execute(
            select(TrackComment.track_id, func.count(TrackComment.id))
            .where(TrackComment.track_id.in_(track_ids))
            .group_by(TrackComment.track_id)
        )
        comment_counts = {row[0]: row[1] for row in comment_result.all()}

    track_responses = []
    for track in tracks:
        track_responses.append(
            TrackResponse(
                id=track.id,
                title=track.title,
                artist=ArtistRef(
                    did=track.artist.did,
                    handle=track.artist.handle,
                    display_name=track.artist.display_name,
                    avatar_url=track.artist.avatar_url,
                ),
                album=AlbumRef(
                    id=str(track.album_rel.id),
                    title=track.album_rel.title,
                    slug=track.album_rel.slug,
                    image_url=track.album_rel.image_url,
                )
                if track.album_rel
                else None,
                audio_url=track.r2_url,
                image_url=track.image_url,
                duration_ms=track.extra.get("duration_ms") if track.extra else None,
                play_count=track.play_count or 0,
                like_count=like_counts.get(track.id, 0),
                comment_count=comment_counts.get(track.id, 0),
                created_at=track.created_at.isoformat(),
            )
        )

    return TrackListResponse(tracks=track_responses, has_more=False)
