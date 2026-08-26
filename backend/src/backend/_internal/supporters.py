"""supporter verification choke point.

answers "does DID X support artist DID Y" from, in order: attested.network
payment attestations (broker-verified, portable across apps), then the
atprotofans validateSupporter endpoint. results are cached per pair in Redis;
transient failures are not cached. all supporter gating flows through here —
new verification sources become branches of validate_supporter, not new
call sites.
"""

import asyncio
import logging

import logfire
from redis.exceptions import RedisError

from backend._internal.atprotofans import SupporterValidation, check_atprotofans_support
from backend._internal.attested import check_attested_support
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

SUPPORTER_CACHE_TTL = 300  # 5 minutes


def _cache_key(supporter_did: str, artist_did: str) -> str:
    return f"supporter:{supporter_did}:{artist_did}"


async def _get_cached(supporter_did: str, artist_did: str) -> bool | None:
    """check Redis for cached supporter validation. returns True/False or None on miss."""
    try:
        redis = get_async_redis_client()
        val = await redis.get(_cache_key(supporter_did, artist_did))
        if val is not None:
            return val == "1"
    except (RuntimeError, RedisError):
        pass
    return None


async def _set_cached(supporter_did: str, artist_did: str, valid: bool) -> None:
    """cache supporter validation result in Redis."""
    try:
        redis = get_async_redis_client()
        await redis.set(
            _cache_key(supporter_did, artist_did),
            "1" if valid else "0",
            ex=SUPPORTER_CACHE_TTL,
        )
    except (RuntimeError, RedisError):
        logger.debug("failed to cache supporter validation")


async def validate_supporter(
    supporter_did: str,
    artist_did: str,
    timeout: float = 5.0,
) -> SupporterValidation:
    """validate whether a user supports an artist.

    checks attested.network payment attestations first, then atprotofans.
    results are cached in Redis for 5 minutes; a transient atprotofans
    failure is treated as not-a-supporter without caching.
    """
    cached = await _get_cached(supporter_did, artist_did)
    if cached is not None:
        logfire.info(
            "supporter cache hit",
            valid=cached,
            supporter_did=supporter_did,
            artist_did=artist_did,
        )
        return SupporterValidation(valid=cached)

    if await check_attested_support(supporter_did, artist_did, timeout):
        await _set_cached(supporter_did, artist_did, True)
        return SupporterValidation(valid=True)

    result = await check_atprotofans_support(supporter_did, artist_did, timeout)
    if result is None:
        return SupporterValidation(valid=False)

    await _set_cached(supporter_did, artist_did, result.valid)
    return result


async def get_supported_artists(
    supporter_did: str,
    artist_dids: set[str],
    timeout: float = 5.0,
) -> set[str]:
    """batch check which artists a user supports.

    args:
        supporter_did: DID of the potential supporter
        artist_dids: set of artist DIDs to check
        timeout: request timeout per check

    returns:
        set of artist DIDs the user supports
    """
    if not artist_dids:
        return set()

    async def check_one(artist_did: str) -> str | None:
        result = await validate_supporter(supporter_did, artist_did, timeout)
        return artist_did if result.valid else None

    results = await asyncio.gather(*[check_one(did) for did in artist_dids])
    return {did for did in results if did is not None}
