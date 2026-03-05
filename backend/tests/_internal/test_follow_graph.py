"""tests for bluesky follow graph caching."""

import time
from unittest.mock import AsyncMock, patch

import pytest

from backend._internal.follow_graph import (
    FOLLOWS_CACHE_PREFIX,
    FOLLOWS_CACHE_TTL_SECONDS,
    FOLLOWS_REVALIDATING_PREFIX,
    FOLLOWS_STALE_AFTER_SECONDS,
    FOLLOWS_TIMESTAMP_PREFIX,
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

TEST_DID = "did:plc:test"


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
    redis.set = AsyncMock(return_value=True)
    return redis


@pytest.fixture
def mock_fetch() -> AsyncMock:
    return AsyncMock(return_value=SAMPLE_FOLLOWS)


def _make_redis_getter(cache_data: str | None = None, timestamp: str | None = None):
    """create a side_effect for redis.get that returns different values per key."""
    cache_key = f"{FOLLOWS_CACHE_PREFIX}{TEST_DID}"
    ts_key = f"{FOLLOWS_TIMESTAMP_PREFIX}{TEST_DID}"

    async def _get(key: str) -> str | None:
        if key == cache_key:
            return cache_data
        if key == ts_key:
            return timestamp
        return None

    return _get


async def test_cache_hit(mock_redis: AsyncMock) -> None:
    """returns cached data without calling bluesky (fresh cache)."""
    mock_redis.get.side_effect = _make_redis_getter(
        cache_data=_serialize_follows(SAMPLE_FOLLOWS),
        timestamp=str(time.time()),  # fresh
    )

    with (
        patch(
            "backend._internal.follow_graph.get_async_redis_client",
            return_value=mock_redis,
        ),
        patch(
            "backend._internal.follow_graph._fetch_follows_from_bsky",
        ) as mock_bsky,
    ):
        result = await get_follows(TEST_DID)

    assert result == SAMPLE_FOLLOWS
    mock_bsky.assert_not_called()


async def test_cache_miss_fetches_and_writes(
    mock_redis: AsyncMock, mock_fetch: AsyncMock
) -> None:
    """on miss, fetches from bluesky and writes data + timestamp to redis."""
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
        result = await get_follows(TEST_DID)

    assert result == SAMPLE_FOLLOWS
    mock_fetch.assert_awaited_once_with(TEST_DID)

    # verify both data and timestamp were written
    assert mock_redis.set.await_count == 2

    data_call = mock_redis.set.call_args_list[0]
    assert data_call[0][0] == f"{FOLLOWS_CACHE_PREFIX}{TEST_DID}"
    assert data_call[1]["ex"] == FOLLOWS_CACHE_TTL_SECONDS
    assert _deserialize_follows(data_call[0][1]) == SAMPLE_FOLLOWS

    ts_call = mock_redis.set.call_args_list[1]
    assert ts_call[0][0] == f"{FOLLOWS_TIMESTAMP_PREFIX}{TEST_DID}"
    assert ts_call[1]["ex"] == FOLLOWS_CACHE_TTL_SECONDS


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
        result = await get_follows(TEST_DID)

    assert result == SAMPLE_FOLLOWS
    mock_fetch.assert_awaited_once()


async def test_warm_writes_to_redis(
    mock_redis: AsyncMock, mock_fetch: AsyncMock
) -> None:
    """warm_follows_cache always fetches and writes data + timestamp to redis."""
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
        await warm_follows_cache(TEST_DID)

    mock_fetch.assert_awaited_once_with(TEST_DID)

    # data + timestamp = 2 set calls
    assert mock_redis.set.await_count == 2
    data_call = mock_redis.set.call_args_list[0]
    assert data_call[0][0] == f"{FOLLOWS_CACHE_PREFIX}{TEST_DID}"
    assert data_call[1]["ex"] == FOLLOWS_CACHE_TTL_SECONDS


# --- stale-while-revalidate tests ---


async def test_stale_cache_triggers_revalidation(mock_redis: AsyncMock) -> None:
    """cache >8min old returns data immediately and schedules a background re-warm."""
    stale_ts = str(time.time() - FOLLOWS_STALE_AFTER_SECONDS - 10)
    mock_redis.get.side_effect = _make_redis_getter(
        cache_data=_serialize_follows(SAMPLE_FOLLOWS),
        timestamp=stale_ts,
    )

    with (
        patch(
            "backend._internal.follow_graph.get_async_redis_client",
            return_value=mock_redis,
        ),
        patch(
            "backend._internal.follow_graph._fetch_follows_from_bsky",
        ) as mock_bsky,
        patch(
            "backend._internal.tasks.schedule_follow_graph_warm",
        ) as mock_schedule,
    ):
        result = await get_follows(TEST_DID)

    # returns cached data without live fetch
    assert result == SAMPLE_FOLLOWS
    mock_bsky.assert_not_called()

    # acquired revalidation lock and scheduled re-warm
    mock_redis.set.assert_awaited_once_with(
        f"{FOLLOWS_REVALIDATING_PREFIX}{TEST_DID}", "1", nx=True, ex=60
    )
    mock_schedule.assert_awaited_once_with(TEST_DID)


async def test_fresh_cache_does_not_revalidate(mock_redis: AsyncMock) -> None:
    """cache <8min old does not trigger any background re-warm."""
    fresh_ts = str(time.time() - 60)  # 1 minute old
    mock_redis.get.side_effect = _make_redis_getter(
        cache_data=_serialize_follows(SAMPLE_FOLLOWS),
        timestamp=fresh_ts,
    )

    with (
        patch(
            "backend._internal.follow_graph.get_async_redis_client",
            return_value=mock_redis,
        ),
        patch(
            "backend._internal.follow_graph._fetch_follows_from_bsky",
        ) as mock_bsky,
        patch(
            "backend._internal.tasks.schedule_follow_graph_warm",
        ) as mock_schedule,
    ):
        result = await get_follows(TEST_DID)

    assert result == SAMPLE_FOLLOWS
    mock_bsky.assert_not_called()

    # no revalidation lock acquired, no re-warm scheduled
    mock_redis.set.assert_not_awaited()
    mock_schedule.assert_not_awaited()


async def test_concurrent_revalidation_deduped(mock_redis: AsyncMock) -> None:
    """two stale requests only trigger one re-warm (SET NX dedup)."""
    stale_ts = str(time.time() - FOLLOWS_STALE_AFTER_SECONDS - 10)
    mock_redis.get.side_effect = _make_redis_getter(
        cache_data=_serialize_follows(SAMPLE_FOLLOWS),
        timestamp=stale_ts,
    )

    # first call acquires lock, second is rejected
    mock_redis.set.side_effect = [True, False]

    with (
        patch(
            "backend._internal.follow_graph.get_async_redis_client",
            return_value=mock_redis,
        ),
        patch(
            "backend._internal.follow_graph._fetch_follows_from_bsky",
        ) as mock_bsky,
        patch(
            "backend._internal.tasks.schedule_follow_graph_warm",
        ) as mock_schedule,
    ):
        result1 = await get_follows(TEST_DID)
        result2 = await get_follows(TEST_DID)

    assert result1 == SAMPLE_FOLLOWS
    assert result2 == SAMPLE_FOLLOWS
    mock_bsky.assert_not_called()

    # only one schedule call despite two stale reads
    mock_schedule.assert_awaited_once_with(TEST_DID)
