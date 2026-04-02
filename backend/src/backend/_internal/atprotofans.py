"""atprotofans integration for supporter validation.

atprotofans is a creator support platform on ATProto. this module provides
server-side validation of supporter relationships for content gating.

the validation uses the three-party model:
- supporter: has com.atprotofans.supporter record in their PDS
- creator: has com.atprotofans.supporterProof record in their PDS
- broker: has com.atprotofans.brokerProof record (atprotofans service)

for direct atprotofans contributions (not via platform registration),
the signer is the artist's own DID.

see: https://atprotofans.leaflet.pub/3mabsmts3rs2b
"""

import asyncio
import logging

import httpx
import logfire
from pydantic import BaseModel
from redis.exceptions import RedisError

from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

SUPPORTER_CACHE_TTL = 300  # 5 minutes


class SupporterValidation(BaseModel):
    """result of validating supporter status."""

    valid: bool
    profile: dict | None = None


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
    """validate if a user supports an artist via atprotofans.

    for direct atprotofans contributions, the signer is the artist's DID.
    results are cached in Redis for 5 minutes.

    args:
        supporter_did: DID of the potential supporter
        artist_did: DID of the artist (also used as signer)
        timeout: request timeout in seconds

    returns:
        SupporterValidation with valid=True if supporter, valid=False otherwise
    """
    # check cache first
    cached = await _get_cached(supporter_did, artist_did)
    if cached is not None:
        logfire.info(
            "atprotofans cache hit",
            valid=cached,
            supporter_did=supporter_did,
            artist_did=artist_did,
        )
        return SupporterValidation(valid=cached)

    url = "https://atprotofans.com/xrpc/com.atprotofans.validateSupporter"
    params = {
        "supporter": supporter_did,
        "subject": artist_did,
        "signer": artist_did,  # for direct contributions, signer = artist
    }

    with logfire.span(
        "atprotofans.validate_supporter",
        supporter_did=supporter_did,
        artist_did=artist_did,
    ):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(url, params=params)

                if response.status_code != 200:
                    logfire.warn(
                        "atprotofans validation failed",
                        status_code=response.status_code,
                        response_text=response.text[:200],
                    )
                    await _set_cached(supporter_did, artist_did, False)
                    return SupporterValidation(valid=False)

                data = response.json()
                is_valid = data.get("valid", False)

                logfire.info(
                    "atprotofans validation result",
                    valid=is_valid,
                    has_profile=data.get("profile") is not None,
                )

                await _set_cached(supporter_did, artist_did, is_valid)
                return SupporterValidation(
                    valid=is_valid,
                    profile=data.get("profile"),
                )

        except httpx.TimeoutException:
            logfire.warn("atprotofans validation timeout")
            return SupporterValidation(valid=False)
        except Exception as e:
            logfire.error(
                "atprotofans validation error",
                error=str(e),
                exc_info=True,
            )
            return SupporterValidation(valid=False)


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
