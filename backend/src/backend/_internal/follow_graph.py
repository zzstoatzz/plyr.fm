"""bluesky follow graph with Redis read-through caching."""

import json
import logging
from dataclasses import asdict, dataclass

import httpx
import logfire

from backend._internal.atproto.profile import BSKY_API_BASE, normalize_avatar_url
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

FOLLOWS_CACHE_PREFIX = "plyr:follows:"
FOLLOWS_CACHE_TTL_SECONDS = 600  # 10 minutes


@dataclass(frozen=True, slots=True)
class FollowInfo:
    """metadata about a follow relationship from bluesky."""

    index: int  # enumeration position (0 = most recent, higher = older)
    avatar_url: str | None  # avatar from bluesky profile


async def get_follows(did: str) -> dict[str, FollowInfo]:
    """get all DIDs a user follows on bluesky, with Redis read-through cache.

    checks Redis first, falls back to live Bluesky API on miss,
    then writes back to cache. fails silently on Redis errors.
    """
    cache_key = f"{FOLLOWS_CACHE_PREFIX}{did}"

    # try cache
    try:
        redis = get_async_redis_client()
        if cached := await redis.get(cache_key):
            return _deserialize_follows(cached)
    except Exception:
        logger.debug("redis cache read failed for follows %s", did)

    # cache miss — fetch live
    follows = await _fetch_follows_from_bsky(did)

    # write back
    try:
        redis = get_async_redis_client()
        await redis.set(
            cache_key, _serialize_follows(follows), ex=FOLLOWS_CACHE_TTL_SECONDS
        )
    except Exception:
        logger.debug("redis cache write failed for follows %s", did)

    return follows


async def warm_follows_cache(did: str) -> None:
    """always fetch from bluesky and write to Redis. called from background task."""
    follows = await _fetch_follows_from_bsky(did)
    cache_key = f"{FOLLOWS_CACHE_PREFIX}{did}"
    try:
        redis = get_async_redis_client()
        await redis.set(
            cache_key, _serialize_follows(follows), ex=FOLLOWS_CACHE_TTL_SECONDS
        )
        logfire.info("warmed follows cache", did=did, count=len(follows))
    except Exception:
        logger.debug("redis cache write failed warming follows for %s", did)


async def _fetch_follows_from_bsky(did: str) -> dict[str, FollowInfo]:
    """fetch all DIDs a user follows on bluesky with profile metadata.

    returns a mapping of DID -> FollowInfo. enumeration order approximates
    follow age (0 = most recently followed) since the API paginates by TID.
    """
    follows: dict[str, FollowInfo] = {}
    cursor: str | None = None
    index = 0

    async with httpx.AsyncClient() as client:
        while True:
            params: dict[str, str | int] = {"actor": did, "limit": 100}
            if cursor:
                params["cursor"] = cursor

            resp = await client.get(
                f"{BSKY_API_BASE}/app.bsky.graph.getFollows",
                params=params,
                timeout=10.0,
            )
            if resp.status_code != 200:
                logger.warning("getFollows failed for %s: %s", did, resp.status_code)
                break

            data = resp.json()
            for f in data.get("follows", []):
                follows[f["did"]] = FollowInfo(
                    index=index,
                    avatar_url=normalize_avatar_url(f.get("avatar")),
                )
                index += 1

            if not (cursor := data.get("cursor")):
                break

    return follows


def _serialize_follows(follows: dict[str, FollowInfo]) -> str:
    """serialize follow map to JSON for Redis storage."""
    return json.dumps({did: asdict(info) for did, info in follows.items()})


def _deserialize_follows(raw: str) -> dict[str, FollowInfo]:
    """deserialize follow map from Redis JSON."""
    return {did: FollowInfo(**info) for did, info in json.loads(raw).items()}
