"""album cache utilities and response-builder helpers."""

import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Album, Artist, Track
from backend.utilities.redis import get_async_redis_client

from .schemas import AlbumListItem, AlbumMetadata, ArtistAlbumListItem

logger = logging.getLogger(__name__)

ALBUM_CACHE_PREFIX = "plyr:album:"
ALBUM_CACHE_TTL_SECONDS = 300  # 5 minutes


def _album_cache_key(handle: str, slug: str) -> str:
    return f"{ALBUM_CACHE_PREFIX}{handle}/{slug}"


async def invalidate_album_cache(handle: str, slug: str) -> None:
    """delete cached album response. fails silently."""
    try:
        redis = get_async_redis_client()
        await redis.delete(_album_cache_key(handle, slug))
    except Exception:
        logger.debug("failed to invalidate album cache for %s/%s", handle, slug)


async def invalidate_album_cache_by_id(db: AsyncSession, album_id: str) -> None:
    """look up album handle+slug and invalidate cache. fails silently."""
    try:
        result = await db.execute(
            select(Album.slug, Artist.handle)
            .join(Artist, Album.artist_did == Artist.did)
            .where(Album.id == album_id)
        )
        if row := result.first():
            slug, handle = row
            await invalidate_album_cache(handle, slug)
    except Exception:
        logger.debug("failed to invalidate album cache by id %s", album_id)


async def _album_stats(db: AsyncSession, album_id: str) -> tuple[int, int]:
    result = await db.execute(
        select(
            func.count(Track.id),
            func.coalesce(func.sum(Track.play_count), 0),
        ).where(Track.album_id == album_id)
    )
    track_count, total_plays = result.one()
    return int(track_count or 0), int(total_plays or 0)


async def _album_image_url(album: Album, artist: Artist | None = None) -> str | None:
    if album.image_url:
        return album.image_url
    if album.image_id:
        return await album.get_image_url()
    if artist and artist.avatar_url:
        return artist.avatar_url
    return None


async def _album_list_item(
    album: Album,
    artist: Artist,
    track_count: int,
    total_plays: int,
) -> AlbumListItem:
    image_url = await _album_image_url(album, artist)
    return AlbumListItem(
        id=album.id,
        title=album.title,
        slug=album.slug,
        artist=artist.display_name,
        artist_handle=artist.handle,
        track_count=track_count,
        total_plays=total_plays,
        image_url=image_url,
    )


async def _artist_album_summary(
    album: Album,
    artist: Artist,
    track_count: int,
    total_plays: int,
) -> ArtistAlbumListItem:
    image_url = await _album_image_url(album, artist)
    return ArtistAlbumListItem(
        id=album.id,
        title=album.title,
        slug=album.slug,
        track_count=track_count,
        total_plays=total_plays,
        image_url=image_url,
    )


async def _album_metadata(
    album: Album,
    artist: Artist,
    track_count: int,
    total_plays: int,
) -> AlbumMetadata:
    image_url = await _album_image_url(album, artist)
    return AlbumMetadata(
        id=album.id,
        title=album.title,
        slug=album.slug,
        description=album.description,
        artist=artist.display_name,
        artist_handle=artist.handle,
        artist_did=artist.did,
        track_count=track_count,
        total_plays=total_plays,
        image_url=image_url,
        list_uri=album.atproto_record_uri,
    )
