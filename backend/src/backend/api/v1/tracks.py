"""v1 API - tracks endpoints."""

import base64
import binascii
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal.auth import AuthContext, require_auth_v1
from backend.models import Artist, Track, TrackLike, get_db

router = APIRouter(prefix="/tracks", tags=["tracks"])


class ArtistRef(BaseModel):
    """artist reference in track response."""

    did: str
    handle: str
    display_name: str
    avatar_url: str | None = None


class AlbumRef(BaseModel):
    """album reference in track response."""

    id: str
    title: str
    slug: str
    image_url: str | None = None


class TrackResponse(BaseModel):
    """track response model for v1 API."""

    id: int
    title: str
    artist: ArtistRef
    album: AlbumRef | None = None
    audio_url: str | None = None
    image_url: str | None = None
    duration_ms: int | None = None
    play_count: int = 0
    like_count: int = 0
    comment_count: int = 0
    created_at: str


class TrackListResponse(BaseModel):
    """paginated track list response."""

    tracks: list[TrackResponse]
    cursor: str | None = None
    has_more: bool = False


@router.get("/", response_model=TrackListResponse)
async def list_tracks(
    db: Annotated[AsyncSession, Depends(get_db)],
    artist: Annotated[str | None, Query(description="filter by artist handle")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    cursor: Annotated[str | None, Query(description="pagination cursor")] = None,
) -> TrackListResponse:
    """list tracks with optional filtering.

    public endpoint - no authentication required.
    """
    # base query with eager loading
    query = (
        select(Track)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .join(Artist, Track.artist_did == Artist.did)
        .order_by(Track.created_at.desc())
    )

    # filter by artist
    if artist:
        query = query.where(Artist.handle == artist)

    # pagination via cursor (simple offset-based for now)
    offset = 0
    if cursor:
        try:
            offset = int(base64.b64decode(cursor).decode())
        except (ValueError, binascii.Error):
            offset = 0

    query = query.offset(offset).limit(limit + 1)  # +1 to check has_more

    result = await db.execute(query)
    tracks = list(result.scalars().all())

    # check if there are more results
    has_more = len(tracks) > limit
    if has_more:
        tracks = tracks[:limit]

    # get like counts
    track_ids = [t.id for t in tracks]
    like_counts: dict[int, int] = {}
    if track_ids:
        like_result = await db.execute(
            select(TrackLike.track_id, func.count(TrackLike.id))
            .where(TrackLike.track_id.in_(track_ids))
            .group_by(TrackLike.track_id)
        )
        like_counts = {row[0]: row[1] for row in like_result.all()}

    # build response
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
                comment_count=0,  # TODO: add comment count
                created_at=track.created_at.isoformat(),
            )
        )

    # build next cursor
    next_cursor = None
    if has_more:
        next_cursor = base64.b64encode(str(offset + limit).encode()).decode()

    return TrackListResponse(
        tracks=track_responses,
        cursor=next_cursor,
        has_more=has_more,
    )


@router.get("/{track_id}", response_model=TrackResponse)
async def get_track(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TrackResponse:
    """get a single track by id.

    public endpoint - no authentication required.
    """
    result = await db.execute(
        select(Track)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .join(Artist, Track.artist_did == Artist.did)
        .where(Track.id == track_id)
    )
    track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    # get like count
    like_result = await db.execute(
        select(func.count(TrackLike.id)).where(TrackLike.track_id == track_id)
    )
    like_count = like_result.scalar() or 0

    return TrackResponse(
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
        like_count=like_count,
        comment_count=0,
        created_at=track.created_at.isoformat(),
    )


@router.get("/me/tracks", response_model=TrackListResponse)
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

    # get like counts
    track_ids = [t.id for t in tracks]
    like_counts: dict[int, int] = {}
    if track_ids:
        like_result = await db.execute(
            select(TrackLike.track_id, func.count(TrackLike.id))
            .where(TrackLike.track_id.in_(track_ids))
            .group_by(TrackLike.track_id)
        )
        like_counts = {row[0]: row[1] for row in like_result.all()}

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
                comment_count=0,
                created_at=track.created_at.isoformat(),
            )
        )

    return TrackListResponse(tracks=track_responses, has_more=False)
