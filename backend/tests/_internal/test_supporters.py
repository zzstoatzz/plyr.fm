"""tests for the supporter verification choke point (caching + branch order)."""

from collections.abc import Iterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend._internal.supporters import (
    SUPPORTER_CACHE_TTL,
    _cache_key,
    get_supported_artists,
    validate_supporter,
)
from backend.utilities.redis import get_async_redis_client

SUPPORTER_DID = "did:plc:supporter123"
ARTIST_DID = "did:plc:artist456"


@pytest.fixture(autouse=True)
async def _clear_supporter_cache() -> None:
    """clear supporter cache keys before each test."""
    try:
        redis = get_async_redis_client()
        await redis.delete(_cache_key(SUPPORTER_DID, ARTIST_DID))
    except RuntimeError:
        pass


@pytest.fixture
def _no_attested_support() -> Iterator[None]:
    """make the attested branch report no support."""
    with patch(
        "backend._internal.supporters.check_attested_support",
        AsyncMock(return_value=False),
    ):
        yield


def _atprotofans_client(valid: bool) -> AsyncMock:
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"valid": valid, "profile": None}

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)
    return mock_client


async def test_validate_supporter_caches_result(_no_attested_support: None) -> None:
    """first call hits external API, second call hits Redis cache."""
    mock_client = _atprotofans_client(valid=True)

    with patch(
        "backend._internal.atprotofans.httpx.AsyncClient", return_value=mock_client
    ):
        # first call — should hit external API
        result1 = await validate_supporter(SUPPORTER_DID, ARTIST_DID)
        assert result1.valid is True
        assert mock_client.get.call_count == 1

        # second call — should hit cache, not external API
        result2 = await validate_supporter(SUPPORTER_DID, ARTIST_DID)
        assert result2.valid is True
        assert mock_client.get.call_count == 1  # no additional call

    # verify value is in Redis
    redis = get_async_redis_client()
    cached = await redis.get(_cache_key(SUPPORTER_DID, ARTIST_DID))
    assert cached == "1"


async def test_validate_supporter_caches_negative(_no_attested_support: None) -> None:
    """non-supporter results are also cached to avoid repeated lookups."""
    mock_client = _atprotofans_client(valid=False)

    with patch(
        "backend._internal.atprotofans.httpx.AsyncClient", return_value=mock_client
    ):
        result1 = await validate_supporter(SUPPORTER_DID, ARTIST_DID)
        assert result1.valid is False

        result2 = await validate_supporter(SUPPORTER_DID, ARTIST_DID)
        assert result2.valid is False
        assert mock_client.get.call_count == 1

    redis = get_async_redis_client()
    cached = await redis.get(_cache_key(SUPPORTER_DID, ARTIST_DID))
    assert cached == "0"


async def test_cache_ttl_is_set(_no_attested_support: None) -> None:
    """cached value should have a TTL."""
    mock_client = _atprotofans_client(valid=True)

    with patch(
        "backend._internal.atprotofans.httpx.AsyncClient", return_value=mock_client
    ):
        await validate_supporter(SUPPORTER_DID, ARTIST_DID)

    redis = get_async_redis_client()
    ttl = await redis.ttl(_cache_key(SUPPORTER_DID, ARTIST_DID))
    assert 0 < ttl <= SUPPORTER_CACHE_TTL


async def test_attested_support_short_circuits_atprotofans() -> None:
    """a verified attestation validates without consulting atprotofans, and caches."""
    atprotofans = AsyncMock()
    with (
        patch(
            "backend._internal.supporters.check_attested_support",
            AsyncMock(return_value=True),
        ),
        patch("backend._internal.supporters.check_atprotofans_support", atprotofans),
    ):
        result = await validate_supporter(SUPPORTER_DID, ARTIST_DID)

    assert result.valid is True
    atprotofans.assert_not_called()

    redis = get_async_redis_client()
    assert await redis.get(_cache_key(SUPPORTER_DID, ARTIST_DID)) == "1"


async def test_transient_atprotofans_failure_not_cached(
    _no_attested_support: None,
) -> None:
    """a timeout answers not-a-supporter without poisoning the cache."""
    with patch(
        "backend._internal.supporters.check_atprotofans_support",
        AsyncMock(return_value=None),
    ):
        result = await validate_supporter(SUPPORTER_DID, ARTIST_DID)

    assert result.valid is False
    redis = get_async_redis_client()
    assert await redis.get(_cache_key(SUPPORTER_DID, ARTIST_DID)) is None


async def test_get_supported_artists_uses_cache() -> None:
    """batch check should benefit from per-pair caching."""
    # pre-populate cache
    redis = get_async_redis_client()
    await redis.set(_cache_key(SUPPORTER_DID, ARTIST_DID), "1", ex=300)

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch(
        "backend._internal.atprotofans.httpx.AsyncClient", return_value=mock_client
    ):
        result = await get_supported_artists(SUPPORTER_DID, {ARTIST_DID})

    assert ARTIST_DID in result
    # should not have made any HTTP calls — all from cache
    mock_client.get.assert_not_called()
