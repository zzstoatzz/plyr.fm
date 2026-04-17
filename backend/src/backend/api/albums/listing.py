"""read-only album endpoints."""

import asyncio
import logging
from typing import Annotated

from fastapi import Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import get_optional_session
from backend._internal.atproto.records import fetch_list_item_uris
from backend.models import Album, Artist, Track, TrackLike, get_db
from backend.schemas import TrackResponse
from backend.utilities.aggregations import (
    get_comment_counts,
    get_like_counts,
    get_top_likers,
    get_track_tags,
)
from backend.utilities.redis import get_async_redis_client

from .cache import (
    ALBUM_CACHE_TTL_SECONDS,
    _album_cache_key,
    _album_list_item,
    _album_metadata,
    _artist_album_summary,
)
from .router import router
from .schemas import AlbumListItem, AlbumResponse, ArtistAlbumListItem

logger = logging.getLogger(__name__)


@router.get("/")
async def list_albums(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, list[AlbumListItem]]:
    """list all albums with basic metadata.

    albums with zero tracks are hidden — they're either unfinalized drafts
    from the multi-track upload flow or legacy albums awaiting sync. only
    albums that have at least one track appear in public listings.
    """
    stmt = (
        select(
            Album,
            Artist,
            func.count(Track.id).label("track_count"),
            func.coalesce(func.sum(Track.play_count), 0).label("total_plays"),
        )
        .join(Artist, Album.artist_did == Artist.did)
        .outerjoin(Track, Track.album_id == Album.id)
        .group_by(Album.id, Artist.did)
        .having(func.count(Track.id) > 0)
        .order_by(func.lower(Album.title))
    )

    result = await db.execute(stmt)
    albums: list[AlbumListItem] = []
    for album, artist, track_count, total_plays in result:
        albums.append(
            await _album_list_item(
                album,
                artist,
                int(track_count or 0),
                int(total_plays or 0),
            )
        )

    return {"albums": albums}


@router.get("/{handle}")
async def list_artist_albums(
    handle: str, db: Annotated[AsyncSession, Depends(get_db)]
) -> dict[str, list[ArtistAlbumListItem]]:
    """list albums for a specific artist."""
    artist_result = await db.execute(select(Artist).where(Artist.handle == handle))
    artist = artist_result.scalar_one_or_none()
    if not artist:
        raise HTTPException(status_code=404, detail="artist not found")

    stmt = (
        select(
            Album,
            func.count(Track.id).label("track_count"),
            func.coalesce(func.sum(Track.play_count), 0).label("total_plays"),
        )
        .outerjoin(Track, Track.album_id == Album.id)
        .where(Album.artist_did == artist.did)
        .group_by(Album.id)
        .having(func.count(Track.id) > 0)
        .order_by(func.lower(Album.title))
    )
    result = await db.execute(stmt)

    album_items: list[ArtistAlbumListItem] = []
    for album, track_count, total_plays in result:
        album_items.append(
            await _artist_album_summary(
                album,
                artist,
                int(track_count or 0),
                int(total_plays or 0),
            )
        )

    return {"albums": album_items}


@router.get("/{handle}/{slug}")
async def get_album(
    handle: str,
    slug: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: AuthSession | None = Depends(get_optional_session),
) -> AlbumResponse:
    """get album details with tracks (ordered by ATProto list record or created_at)."""
    # check Redis cache first
    cache_key = _album_cache_key(handle, slug)
    try:
        redis = get_async_redis_client()
        if cached := await redis.get(cache_key):
            return AlbumResponse.model_validate_json(cached)
    except Exception:
        logger.debug("album cache read failed for %s/%s", handle, slug)

    # look up artist + album
    album_result = await db.execute(
        select(Album, Artist)
        .join(Artist, Album.artist_did == Artist.did)
        .where(Artist.handle == handle, Album.slug == slug)
    )
    row = album_result.first()
    if not row:
        raise HTTPException(status_code=404, detail="album not found")

    album, artist = row

    pds_cache: dict[str, str | None] = {artist.did: artist.pds_url}

    # fetch all tracks for this album
    track_stmt = (
        select(Track)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
        .where(Track.album_id == album.id)
    )
    track_result = await db.execute(track_stmt)
    all_tracks = list(track_result.scalars().all())

    # determine track order: use ATProto list record if available
    ordered_tracks: list[Track] = []
    if album.atproto_record_uri:
        try:
            track_uris = await fetch_list_item_uris(
                album.atproto_record_uri, artist.pds_url
            )

            # build uri -> track map
            track_by_uri = {t.atproto_record_uri: t for t in all_tracks}

            # order tracks by ATProto list, append any not in list at end
            seen_ids = set()
            for uri in track_uris:
                if uri in track_by_uri:
                    track = track_by_uri[uri]
                    ordered_tracks.append(track)
                    seen_ids.add(track.id)

            # append any tracks not in the ATProto list (fallback)
            for track in sorted(all_tracks, key=lambda t: t.created_at):
                if track.id not in seen_ids:
                    ordered_tracks.append(track)

        except Exception as e:
            logger.warning(f"failed to fetch ATProto list for album ordering: {e}")
            # fallback to created_at order
            ordered_tracks = sorted(all_tracks, key=lambda t: t.created_at)
    else:
        # no ATProto record - order by created_at
        ordered_tracks = sorted(all_tracks, key=lambda t: t.created_at)

    tracks = ordered_tracks
    track_ids = [track.id for track in tracks]

    # batch fetch aggregations
    if track_ids:
        like_counts, comment_counts, track_tags, top_likers = await asyncio.gather(
            get_like_counts(db, track_ids),
            get_comment_counts(db, track_ids),
            get_track_tags(db, track_ids),
            get_top_likers(db, track_ids),
        )
    else:
        like_counts, comment_counts, track_tags, top_likers = {}, {}, {}, {}

    # get authenticated user's likes for this album's tracks only
    liked_track_ids: set[int] | None = None
    if session:
        if track_ids:
            liked_result = await db.execute(
                select(TrackLike.track_id).where(
                    TrackLike.user_did == session.did,
                    TrackLike.track_id.in_(track_ids),
                )
            )
            liked_track_ids = set(liked_result.scalars().all())

    # build track responses (maintaining order)
    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                track,
                pds_cache.get(track.artist_did),
                liked_track_ids,
                like_counts,
                comment_counts,
                track_tags=track_tags,
                top_likers=top_likers,
            )
            for track in tracks
        ]
    )

    total_plays = sum(t.play_count for t in tracks)
    metadata = await _album_metadata(album, artist, len(tracks), total_plays)

    response = AlbumResponse(
        metadata=metadata,
        tracks=[t.model_dump(mode="json") for t in track_responses],
    )

    # cache a depersonalized copy (is_liked zeroed out)
    try:
        redis = get_async_redis_client()
        cache_tracks = [{**t, "is_liked": False} for t in response.tracks]
        cacheable = AlbumResponse(metadata=response.metadata, tracks=cache_tracks)
        await redis.set(
            cache_key, cacheable.model_dump_json(), ex=ALBUM_CACHE_TTL_SECONDS
        )
    except Exception:
        logger.debug("album cache write failed for %s/%s", handle, slug)

    return response
