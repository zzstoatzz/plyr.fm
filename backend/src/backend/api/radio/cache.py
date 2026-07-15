"""Redis cache for the per-station radio rotation.

The rotation is deterministic per (station, limit, period), so every poll of
``/radio/state`` recomputing it from the full eligible catalog is pure waste —
under real listener load that recomputation saturated the database (2026-07-14).
The cache stores the *anonymous* serialized rotation; per-user liked state and
the wall-clock playhead are applied per request on top of it.

Fails open: with Redis unavailable, every request just rebuilds the rotation.
"""

import logging

from pydantic import TypeAdapter

from backend.config import settings
from backend.utilities.redis import get_async_redis_client

from .schemas import RadioTrack

logger = logging.getLogger(__name__)

ROTATION_CACHE_PREFIX = "plyr:radio:rotation:"

_rotation_adapter = TypeAdapter(list[RadioTrack])


def rotation_cache_key(station_slug: str, limit: int, period: str) -> str:
    return f"{ROTATION_CACHE_PREFIX}{station_slug}:{limit}:{period}"


async def get_cached_rotation(
    station_slug: str, limit: int, period: str
) -> list[RadioTrack] | None:
    """Return the cached anonymous rotation, or None on miss/disabled/error."""
    if settings.radio.rotation_cache_ttl_seconds <= 0:
        return None
    try:
        redis = get_async_redis_client()
        if cached := await redis.get(rotation_cache_key(station_slug, limit, period)):
            return _rotation_adapter.validate_json(cached)
    except Exception:
        logger.debug("failed to read rotation cache for %s", station_slug)
    return None


async def set_cached_rotation(
    station_slug: str, limit: int, period: str, rotation: list[RadioTrack]
) -> None:
    """Cache the anonymous rotation. Fails silently."""
    if settings.radio.rotation_cache_ttl_seconds <= 0:
        return
    try:
        redis = get_async_redis_client()
        await redis.set(
            rotation_cache_key(station_slug, limit, period),
            _rotation_adapter.dump_json(rotation),
            ex=settings.radio.rotation_cache_ttl_seconds,
        )
    except Exception:
        logger.debug("failed to write rotation cache for %s", station_slug)
