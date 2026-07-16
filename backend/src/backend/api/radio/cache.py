"""Redis cache for the per-station radio rotation.

The rotation is deterministic per (station, limit, period), so every poll of
``/radio/state`` recomputing it from the full eligible catalog is pure waste —
under real listener load that recomputation saturated the database (2026-07-14).
The cache stores the *anonymous* serialized rotation; per-user liked state and
the wall-clock playhead are applied per request on top of it.

The miss path is single-flight: concurrent polls that all observe an expired
key would otherwise stampede the database in a burst every TTL, which is the
same saturation the cache exists to prevent. One request takes a short-lived
build lock and rebuilds; the rest poll for the populated value and only build
themselves if the lock holder dies or stalls.

Fails open: with Redis unavailable, every request just rebuilds the rotation.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable

from pydantic import TypeAdapter

from backend.config import settings
from backend.utilities.redis import get_async_redis_client

from .schemas import RadioTrack

logger = logging.getLogger(__name__)

ROTATION_CACHE_PREFIX = "plyr:radio:rotation:v2:"
# generous next to a normal sub-second rebuild, so the lock only expires under
# a genuinely dead or stalled holder rather than a slow database.
BUILD_LOCK_TTL_SECONDS = 10
BUILD_WAIT_POLL_SECONDS = 0.1
BUILD_WAIT_MAX_POLLS = 20

_rotation_adapter = TypeAdapter(list[RadioTrack])


def rotation_cache_key(station_slug: str, limit: int, period: str) -> str:
    return f"{ROTATION_CACHE_PREFIX}{station_slug}:{limit}:{period}"


async def get_rotation(
    station_slug: str,
    limit: int,
    period: str,
    build: Callable[[], Awaitable[list[RadioTrack]]],
) -> list[RadioTrack]:
    """Return the anonymous rotation, building it at most once per TTL.

    ``build`` runs on a cache miss, guarded by a single-flight lock so
    concurrent misses don't each hit the database. Any Redis failure falls
    back to building directly.
    """
    if settings.radio.rotation_cache_ttl_seconds <= 0:
        return await build()

    key = rotation_cache_key(station_slug, limit, period)
    try:
        redis = get_async_redis_client()
        if cached := await redis.get(key):
            return _rotation_adapter.validate_json(cached)
        acquired = await redis.set(
            f"{key}:build", "1", nx=True, ex=BUILD_LOCK_TTL_SECONDS
        )
    except Exception:
        logger.debug("rotation cache unavailable for %s; building", station_slug)
        return await build()

    if not acquired:
        if awaited := await _wait_for_rotation(key):
            return awaited
        logger.debug("rotation build lock holder stalled for %s", station_slug)
        return await build()

    try:
        rotation = await build()
        if rotation:
            try:
                await redis.set(
                    key,
                    _rotation_adapter.dump_json(rotation),
                    ex=settings.radio.rotation_cache_ttl_seconds,
                )
            except Exception:
                logger.debug("failed to write rotation cache for %s", station_slug)
        return rotation
    finally:
        try:
            await redis.delete(f"{key}:build")
        except Exception:
            logger.debug("failed to release rotation build lock for %s", station_slug)


async def _wait_for_rotation(key: str) -> list[RadioTrack] | None:
    """Poll for the value another request is building; None if it never lands."""
    for _ in range(BUILD_WAIT_MAX_POLLS):
        await asyncio.sleep(BUILD_WAIT_POLL_SECONDS)
        try:
            redis = get_async_redis_client()
            if cached := await redis.get(key):
                return _rotation_adapter.validate_json(cached)
        except Exception:
            return None
    return None
