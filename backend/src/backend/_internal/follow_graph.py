"""bluesky follow graph with Redis read-through caching and stale-while-revalidate."""

import json
import logging
import time
from dataclasses import asdict, dataclass

import httpx
import logfire
from redis.exceptions import RedisError

from backend._internal.atproto.profile import BSKY_API_BASE, normalize_avatar_url
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

FOLLOWS_CACHE_PREFIX = "plyr:follows:"
FOLLOWS_TIMESTAMP_PREFIX = "plyr:follows:ts:"
FOLLOWS_REVALIDATING_PREFIX = "plyr:follows:revalidating:"
FOLLOWS_CACHE_TTL_SECONDS = 3600  # 60 minutes
FOLLOWS_STALE_AFTER_SECONDS = 480  # 8 minutes


@dataclass(frozen=True, slots=True)
class FollowInfo:
    """metadata about a follow relationship from bluesky."""

    index: int  # enumeration position (0 = most recent, higher = older)
    avatar_url: str | None  # avatar from bluesky profile


async def get_follows(did: str) -> dict[str, FollowInfo]:
    """get all DIDs a user follows on bluesky, with Redis read-through cache.

    uses stale-while-revalidate: returns cached data immediately even if stale,
    and schedules a background re-warm when data is older than FOLLOWS_STALE_AFTER_SECONDS.
    on cache miss, fetches live from Bluesky and writes back. fails silently on Redis errors.
    """
    cache_key = f"{FOLLOWS_CACHE_PREFIX}{did}"
    ts_key = f"{FOLLOWS_TIMESTAMP_PREFIX}{did}"

    # try cache
    try:
        redis = get_async_redis_client()
        if cached := await redis.get(cache_key):
            follows = _deserialize_follows(cached)

            # check staleness — schedule background re-warm if stale
            try:
                ts_raw = await redis.get(ts_key)
                if ts_raw and time.time() - float(ts_raw) > FOLLOWS_STALE_AFTER_SECONDS:
                    await _maybe_schedule_revalidation(did)
            except (RuntimeError, RedisError):
                logger.debug("redis staleness check failed for follows %s", did)

            return follows
    except (RuntimeError, RedisError):
        logger.debug("redis cache read failed for follows %s", did)

    # cache miss — fetch live
    follows = await _fetch_follows_from_bsky(did)

    # write back with timestamp
    try:
        redis = get_async_redis_client()
        await redis.set(
            cache_key, _serialize_follows(follows), ex=FOLLOWS_CACHE_TTL_SECONDS
        )
        await redis.set(ts_key, str(time.time()), ex=FOLLOWS_CACHE_TTL_SECONDS)
    except (RuntimeError, RedisError):
        logger.debug("redis cache write failed for follows %s", did)

    return follows


async def _maybe_schedule_revalidation(did: str) -> None:
    """schedule a background re-warm if no revalidation is already in progress.

    uses SET NX on a revalidating key to dedup concurrent requests.
    """
    revalidating_key = f"{FOLLOWS_REVALIDATING_PREFIX}{did}"
    try:
        redis = get_async_redis_client()
        if await redis.set(revalidating_key, "1", nx=True, ex=60):
            from backend._internal.tasks import schedule_follow_graph_warm

            await schedule_follow_graph_warm(did)
    except (RuntimeError, RedisError):
        logger.debug("failed to schedule revalidation for follows %s", did)


async def warm_follows_cache(did: str) -> None:
    """always fetch from bluesky and write to Redis. called from background task."""
    follows = await _fetch_follows_from_bsky(did)
    cache_key = f"{FOLLOWS_CACHE_PREFIX}{did}"
    ts_key = f"{FOLLOWS_TIMESTAMP_PREFIX}{did}"
    try:
        redis = get_async_redis_client()
        await redis.set(
            cache_key, _serialize_follows(follows), ex=FOLLOWS_CACHE_TTL_SECONDS
        )
        await redis.set(ts_key, str(time.time()), ex=FOLLOWS_CACHE_TTL_SECONDS)
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
