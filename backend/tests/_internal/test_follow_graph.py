"""tests for bluesky follow graph caching."""

from unittest.mock import AsyncMock, patch

import pytest

from backend._internal.follow_graph import (
    FOLLOWS_CACHE_PREFIX,
    FOLLOWS_CACHE_TTL_SECONDS,
    FollowInfo,
    _deserialize_follows,
    _serialize_follows,
    get_follows,
    warm_follows_cache,
)

SAMPLE_FOLLOWS: dict[str, FollowInfo] = {
    "did:plc:alice": FollowInfo(index=0, avatar_url="https://cdn.bsky.app/alice.jpg"),
    "did:plc:bob": FollowInfo(index=1, avatar_url=None),
}


def test_serialization_roundtrip() -> None:
    """serialize -> deserialize preserves data."""
    result = _deserialize_follows(_serialize_follows(SAMPLE_FOLLOWS))
    assert result == SAMPLE_FOLLOWS


def test_serialization_empty() -> None:
    """empty dict roundtrips correctly."""
    result = _deserialize_follows(_serialize_follows({}))
    assert result == {}


@pytest.fixture
def mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.set = AsyncMock()
    return redis


@pytest.fixture
def mock_fetch() -> AsyncMock:
    return AsyncMock(return_value=SAMPLE_FOLLOWS)


async def test_cache_hit(mock_redis: AsyncMock) -> None:
    """returns cached data without calling bluesky."""
    mock_redis.get.return_value = _serialize_follows(SAMPLE_FOLLOWS)

    with (
        patch(
            "backend._internal.follow_graph.get_async_redis_client",
            return_value=mock_redis,
        ),
        patch(
            "backend._internal.follow_graph._fetch_follows_from_bsky",
        ) as mock_fetch,
    ):
        result = await get_follows("did:plc:test")

    assert result == SAMPLE_FOLLOWS
    mock_fetch.assert_not_called()


async def test_cache_miss_fetches_and_writes(
    mock_redis: AsyncMock, mock_fetch: AsyncMock
) -> None:
    """on miss, fetches from bluesky and writes back to redis."""
    with (
        patch(
            "backend._internal.follow_graph.get_async_redis_client",
            return_value=mock_redis,
        ),
        patch(
            "backend._internal.follow_graph._fetch_follows_from_bsky",
            mock_fetch,
        ),
    ):
        result = await get_follows("did:plc:test")

    assert result == SAMPLE_FOLLOWS
    mock_fetch.assert_awaited_once_with("did:plc:test")

    # verify cache write
    mock_redis.set.assert_awaited_once()
    call_args = mock_redis.set.call_args
    assert call_args[0][0] == f"{FOLLOWS_CACHE_PREFIX}did:plc:test"
    assert call_args[1]["ex"] == FOLLOWS_CACHE_TTL_SECONDS

    # verify written data roundtrips
    written = _deserialize_follows(call_args[0][1])
    assert written == SAMPLE_FOLLOWS


async def test_redis_error_falls_back_to_live(mock_fetch: AsyncMock) -> None:
    """redis errors fall back to live fetch without raising."""
    broken_redis = AsyncMock()
    broken_redis.get.side_effect = ConnectionError("redis down")
    broken_redis.set.side_effect = ConnectionError("redis down")

    with (
        patch(
            "backend._internal.follow_graph.get_async_redis_client",
            return_value=broken_redis,
        ),
        patch(
            "backend._internal.follow_graph._fetch_follows_from_bsky",
            mock_fetch,
        ),
    ):
        result = await get_follows("did:plc:test")

    assert result == SAMPLE_FOLLOWS
    mock_fetch.assert_awaited_once()


async def test_warm_writes_to_redis(
    mock_redis: AsyncMock, mock_fetch: AsyncMock
) -> None:
    """warm_follows_cache always fetches and writes to redis."""
    with (
        patch(
            "backend._internal.follow_graph.get_async_redis_client",
            return_value=mock_redis,
        ),
        patch(
            "backend._internal.follow_graph._fetch_follows_from_bsky",
            mock_fetch,
        ),
    ):
        await warm_follows_cache("did:plc:test")

    mock_fetch.assert_awaited_once_with("did:plc:test")
    mock_redis.set.assert_awaited_once()
    call_args = mock_redis.set.call_args
    assert call_args[0][0] == f"{FOLLOWS_CACHE_PREFIX}did:plc:test"
    assert call_args[1]["ex"] == FOLLOWS_CACHE_TTL_SECONDS
