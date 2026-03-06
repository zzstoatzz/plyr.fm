"""tests for anonymous discovery feed caching."""

from unittest.mock import AsyncMock, patch

from redis.exceptions import ConnectionError as RedisConnectionError

from backend.api.tracks.constants import DISCOVERY_CACHE_KEY
from backend.api.tracks.listing import (
    TracksListResponse,
    invalidate_tracks_discovery_cache,
)

SAMPLE_RESPONSE = TracksListResponse(tracks=[], next_cursor=None, has_more=False)


async def test_anonymous_discovery_cache_hit() -> None:
    """cached response deserializes correctly from Redis."""
    cached_json = SAMPLE_RESPONSE.model_dump_json()
    result = TracksListResponse.model_validate_json(cached_json)
    assert result == SAMPLE_RESPONSE


async def test_invalidate_clears_cache() -> None:
    """invalidate_tracks_discovery_cache deletes the cache key."""
    mock_redis = AsyncMock()
    mock_redis.delete = AsyncMock()

    with patch(
        "backend.api.tracks.listing.get_async_redis_client",
        return_value=mock_redis,
    ):
        await invalidate_tracks_discovery_cache()

    mock_redis.delete.assert_awaited_once_with(DISCOVERY_CACHE_KEY)


async def test_invalidate_handles_redis_error() -> None:
    """invalidation silently handles Redis errors."""
    mock_redis = AsyncMock()
    mock_redis.delete.side_effect = RedisConnectionError("redis down")

    with patch(
        "backend.api.tracks.listing.get_async_redis_client",
        return_value=mock_redis,
    ):
        # should not raise
        await invalidate_tracks_discovery_cache()
