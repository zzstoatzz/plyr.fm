"""integration tests for session Redis caching."""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from backend._internal.auth.session import (
    SESSION_CACHE_TTL_SECONDS,
    _session_cache_key,
    create_session,
    delete_session,
    get_session,
    update_session_tokens,
)
from backend.utilities.redis import get_async_redis_client


@pytest.fixture
def oauth_data() -> dict:
    return {
        "session_id": "oauth-test-123",
        "access_token": "at_test",
        "refresh_token": "rt_test",
    }


@pytest.fixture
async def session_id(_engine: None, _clear_db: None, oauth_data: dict) -> str:
    """create a real session in the DB and return its session_id."""
    return await create_session(
        did="did:plc:testcache",
        handle="cachetest.bsky.social",
        oauth_session=oauth_data,
    )


async def test_cache_miss_then_hit(session_id: str) -> None:
    """first get_session hits DB and populates cache; second hits cache."""
    redis = get_async_redis_client()
    cache_key = _session_cache_key(session_id)

    # cache should be empty before first call
    assert await redis.get(cache_key) is None

    # first call — DB hit, populates cache
    session = await get_session(session_id)
    assert session is not None
    assert session.did == "did:plc:testcache"

    # cache should now be populated
    cached_raw = await redis.get(cache_key)
    assert cached_raw is not None
    cached = json.loads(cached_raw)
    assert cached["did"] == "did:plc:testcache"
    assert cached["session_id"] == session_id

    # second call — should come from cache (we verify by checking TTL exists)
    session2 = await get_session(session_id)
    assert session2 is not None
    assert session2.did == session.did
    ttl = await redis.ttl(cache_key)
    assert 0 < ttl <= SESSION_CACHE_TTL_SECONDS


async def test_delete_session_invalidates_cache(session_id: str) -> None:
    """delete_session removes the cache entry."""
    redis = get_async_redis_client()
    cache_key = _session_cache_key(session_id)

    # populate cache
    await get_session(session_id)
    assert await redis.get(cache_key) is not None

    # delete should clear cache
    await delete_session(session_id)
    assert await redis.get(cache_key) is None

    # session should be gone
    assert await get_session(session_id) is None


async def test_update_tokens_invalidates_cache(
    session_id: str, oauth_data: dict
) -> None:
    """update_session_tokens invalidates cache so next read gets fresh data."""
    redis = get_async_redis_client()
    cache_key = _session_cache_key(session_id)

    # populate cache
    session = await get_session(session_id)
    assert session is not None
    assert await redis.get(cache_key) is not None

    # update tokens — should invalidate cache
    updated_oauth = {**oauth_data, "access_token": "at_refreshed"}
    await update_session_tokens(session_id, updated_oauth)
    assert await redis.get(cache_key) is None

    # next get_session should hit DB and get fresh data
    refreshed = await get_session(session_id)
    assert refreshed is not None
    assert refreshed.oauth_session["access_token"] == "at_refreshed"


async def test_nonexistent_session_returns_none(_engine: None) -> None:
    """get_session returns None for unknown session_id without caching anything."""
    redis = get_async_redis_client()
    fake_id = "nonexistent-session-id"
    cache_key = _session_cache_key(fake_id)

    assert await get_session(fake_id) is None
    assert await redis.get(cache_key) is None


async def test_graceful_degradation_on_redis_failure(
    session_id: str,
) -> None:
    """get_session falls back to DB when Redis is unavailable."""
    broken_redis = AsyncMock()
    broken_redis.get = AsyncMock(side_effect=ConnectionError("redis down"))
    broken_redis.set = AsyncMock(side_effect=ConnectionError("redis down"))

    with patch(
        "backend._internal.auth.session.get_async_redis_client",
        return_value=broken_redis,
    ):
        session = await get_session(session_id)
        assert session is not None
        assert session.did == "did:plc:testcache"
        assert session.handle == "cachetest.bsky.social"


async def test_cache_hit_checks_expiry(session_id: str) -> None:
    """cached session with expired expires_at returns None and deletes cache entry."""
    redis = get_async_redis_client()
    cache_key = _session_cache_key(session_id)

    # populate cache via normal flow
    session = await get_session(session_id)
    assert session is not None

    # overwrite cache entry with an already-expired expires_at
    cached_raw = await redis.get(cache_key)
    assert cached_raw is not None
    data = json.loads(cached_raw)
    data["expires_at"] = (datetime.now(UTC) - timedelta(seconds=10)).isoformat()
    await redis.set(cache_key, json.dumps(data), ex=SESSION_CACHE_TTL_SECONDS)

    # get_session should detect expiry, delete cache, and return None
    assert await get_session(session_id) is None
    assert await redis.get(cache_key) is None
