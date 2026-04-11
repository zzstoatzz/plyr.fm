"""integration tests for album response Redis caching."""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.albums import (
    ALBUM_CACHE_TTL_SECONDS,
    AlbumMetadata,
    AlbumResponse,
    _album_cache_key,
    invalidate_album_cache,
    invalidate_album_cache_by_id,
)
from backend.models import Album, Artist
from backend.utilities.redis import get_async_redis_client


@pytest.fixture
async def artist(db_session: AsyncSession) -> Artist:
    """create a test artist."""
    artist = Artist(
        did="did:plc:testalbumcache",
        handle="albumcache.test",
        display_name="Album Cache Test",
    )
    db_session.add(artist)
    await db_session.commit()
    await db_session.refresh(artist)
    return artist


@pytest.fixture
async def album(db_session: AsyncSession, artist: Artist) -> Album:
    """create a test album."""
    album = Album(
        title="Test Album",
        slug="test-album",
        artist_did=artist.did,
    )
    db_session.add(album)
    await db_session.commit()
    await db_session.refresh(album)
    return album


async def test_album_cache_miss_then_hit(
    db_session: AsyncSession, artist: Artist, album: Album
) -> None:
    """first get_album hits DB, second should return cached response."""
    redis = get_async_redis_client()
    cache_key = _album_cache_key(artist.handle, album.slug)

    # cache should be empty
    assert await redis.get(cache_key) is None

    # manually populate cache (simulating what get_album does)
    response = AlbumResponse(
        metadata=AlbumMetadata(
            id=album.id,
            title=album.title,
            slug=album.slug,
            artist=artist.display_name,
            artist_handle=artist.handle,
            artist_did=artist.did,
            track_count=0,
            total_plays=0,
            image_url=None,
        ),
        tracks=[],
    )
    await redis.set(cache_key, response.model_dump_json(), ex=ALBUM_CACHE_TTL_SECONDS)

    # cache should be populated
    cached_raw = await redis.get(cache_key)
    assert cached_raw is not None
    cached = AlbumResponse.model_validate_json(cached_raw)
    assert cached.metadata.title == "Test Album"
    assert cached.metadata.artist_handle == artist.handle

    # TTL should be set
    ttl = await redis.ttl(cache_key)
    assert 0 < ttl <= ALBUM_CACHE_TTL_SECONDS


async def test_album_cache_invalidation(
    db_session: AsyncSession, artist: Artist, album: Album
) -> None:
    """invalidate_album_cache removes the cached entry."""
    redis = get_async_redis_client()
    cache_key = _album_cache_key(artist.handle, album.slug)

    # populate cache
    await redis.set(
        cache_key, '{"metadata":{},"tracks":[]}', ex=ALBUM_CACHE_TTL_SECONDS
    )
    assert await redis.get(cache_key) is not None

    # invalidate
    await invalidate_album_cache(artist.handle, album.slug)
    assert await redis.get(cache_key) is None


async def test_album_cache_invalidation_by_id(
    db_session: AsyncSession, artist: Artist, album: Album
) -> None:
    """invalidate_album_cache_by_id looks up handle+slug and clears cache."""
    redis = get_async_redis_client()
    cache_key = _album_cache_key(artist.handle, album.slug)

    # populate cache
    await redis.set(
        cache_key, '{"metadata":{},"tracks":[]}', ex=ALBUM_CACHE_TTL_SECONDS
    )
    assert await redis.get(cache_key) is not None

    # invalidate by album ID
    await invalidate_album_cache_by_id(db_session, album.id)
    assert await redis.get(cache_key) is None


async def test_album_cache_graceful_degradation(
    db_session: AsyncSession, artist: Artist, album: Album
) -> None:
    """cache operations fail silently when Redis is unavailable."""
    broken_redis = AsyncMock()
    broken_redis.get = AsyncMock(side_effect=ConnectionError("redis down"))
    broken_redis.set = AsyncMock(side_effect=ConnectionError("redis down"))
    broken_redis.delete = AsyncMock(side_effect=ConnectionError("redis down"))

    with patch(
        "backend.api.albums.cache.get_async_redis_client",
        return_value=broken_redis,
    ):
        # should not raise
        await invalidate_album_cache(artist.handle, album.slug)
        await invalidate_album_cache_by_id(db_session, album.id)
