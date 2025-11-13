"""albums api endpoints."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal.auth import get_session
from backend.api.tracks import TrackResponse, get_like_counts
from backend.models import Artist, Track, TrackLike, get_db

router = APIRouter(prefix="/albums", tags=["albums"])


class AlbumMetadata(BaseModel):
    """album metadata response."""

    name: str
    slug: str
    artist: str
    artist_handle: str
    track_count: int
    total_plays: int
    image_url: str | None


class AlbumResponse(BaseModel):
    """album detail response with tracks."""

    metadata: AlbumMetadata
    tracks: list[dict]  # TrackResponse is a dict subclass, not a Pydantic model


class AlbumListItem(BaseModel):
    """minimal album info for listing."""

    name: str
    slug: str
    track_count: int


@router.get("/")
async def list_albums(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, list[AlbumListItem]]:
    """list all albums with basic metadata."""
    # query for albums (grouped by album_slug)
    album_name_expr = func.jsonb_extract_path_text(Track.extra, "album")

    result = await db.execute(
        select(
            Track.album_slug,
            album_name_expr.label("album_name"),
            func.count(Track.id).label("track_count"),
        )
        .where(Track.album_slug.isnot(None))
        .group_by(Track.album_slug, album_name_expr)
        .order_by(func.lower(album_name_expr))
    )

    albums = [
        AlbumListItem(
            name=row.album_name,
            slug=row.album_slug,
            track_count=row.track_count,
        )
        for row in result.all()
    ]

    return {"albums": albums}


@router.get("/{slug}")
async def get_album(
    slug: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
) -> AlbumResponse:
    """get album details with all tracks."""
    from atproto_identity.did.resolver import AsyncDidResolver

    # get authenticated user if auth header present
    liked_track_ids: set[int] | None = None
    if (
        session_id := request.headers.get("authorization", "").replace("Bearer ", "")
    ) and (auth_session := await get_session(session_id)):
        liked_result = await db.execute(
            select(TrackLike.track_id).where(TrackLike.user_did == auth_session.did)
        )
        liked_track_ids = set(liked_result.scalars().all())

    # fetch all tracks for this album
    stmt = (
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist))
        .where(Track.album_slug == slug)
        .order_by(Track.created_at.asc())  # chronological order for album tracks
    )

    result = await db.execute(stmt)
    tracks = result.scalars().all()

    if not tracks:
        raise HTTPException(status_code=404, detail="album not found")

    # batch fetch like counts
    track_ids = [track.id for track in tracks]
    like_counts = await get_like_counts(db, track_ids)

    # resolve PDS URLs
    resolver = AsyncDidResolver()
    pds_cache = {}
    artists_to_resolve = {}

    for track in tracks:
        if track.artist_did not in pds_cache:
            if track.artist.pds_url:
                pds_cache[track.artist_did] = track.artist.pds_url
            else:
                if track.artist_did not in artists_to_resolve:
                    artists_to_resolve[track.artist_did] = track.artist

    if artists_to_resolve:

        async def resolve_artist(artist: Artist) -> tuple[str, str | None]:
            try:
                atproto_data = await resolver.resolve_atproto_data(artist.did)
                return (artist.did, atproto_data.pds)
            except Exception:
                return (artist.did, None)

        results = await asyncio.gather(
            *[resolve_artist(a) for a in artists_to_resolve.values()]
        )

        for did, pds_url in results:
            pds_cache[did] = pds_url
            if pds_url:
                artist = artists_to_resolve.get(did)
                if artist:
                    artist.pds_url = pds_url
                    db.add(artist)

    await db.commit()

    # build track responses
    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                track, pds_cache.get(track.artist_did), liked_track_ids, like_counts
            )
            for track in tracks
        ]
    )

    # build album metadata (use first track for artist info)
    first_track = tracks[0]
    total_plays = sum(t.play_count for t in tracks)

    # use first track's image or artist avatar
    image_url = first_track.image_url
    if not image_url and first_track.image_id:
        image_url = await first_track.get_image_url()
    if not image_url:
        image_url = first_track.artist.avatar_url

    metadata = AlbumMetadata(
        name=first_track.album or "Unknown Album",
        slug=slug,
        artist=first_track.artist.display_name,
        artist_handle=first_track.artist.handle,
        track_count=len(tracks),
        total_plays=total_plays,
        image_url=image_url,
    )

    return AlbumResponse(metadata=metadata, tracks=track_responses)
