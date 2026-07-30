"""Is a station's broadcast airing right now?

Polled server-side rather than from each client: the answer is identical for
everyone, so one request per cache window covers the whole audience instead of
pointing every listener at the broadcaster's origin.

Fails closed. A broadcaster we cannot reach is treated as off-air, so the
station falls back to its rotation rather than handing clients a stream URL that
will not load — dead air is the one outcome radio must never produce.
"""

import asyncio
import time
from dataclasses import dataclass

import httpx
import logfire

from backend.api.radio.stations import LiveSource

# how long a liveness answer is reused. short enough that going on or off air
# is noticed promptly, long enough that the broadcaster sees a trickle.
_CACHE_TTL_SECONDS = 5.0
_PROBE_TIMEOUT_SECONDS = 3.0


@dataclass(frozen=True)
class LiveBroadcast:
    """A broadcast confirmed to be airing."""

    stream_url: str
    kind: str
    started_at: str | None


_cache: dict[str, tuple[float, LiveBroadcast | None]] = {}
_locks: dict[str, asyncio.Lock] = {}


def _lock_for(key: str) -> asyncio.Lock:
    if key not in _locks:
        _locks[key] = asyncio.Lock()
    return _locks[key]


async def get_live_broadcast(source: LiveSource | None) -> LiveBroadcast | None:
    """Return the broadcast if it is airing, else None."""
    if source is None:
        return None

    key = source.health_url
    now = time.monotonic()
    cached = _cache.get(key)
    if cached is not None and (now - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]

    # one probe per window even under concurrent requests; whoever loses the
    # race re-reads the cache the winner just filled.
    async with _lock_for(key):
        cached = _cache.get(key)
        if cached is not None and (time.monotonic() - cached[0]) < _CACHE_TTL_SECONDS:
            return cached[1]

        result = await _probe(source)
        _cache[key] = (time.monotonic(), result)
        return result


async def _probe(source: LiveSource) -> LiveBroadcast | None:
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT_SECONDS) as client:
            response = await client.get(source.health_url)
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        logfire.warn(
            "radio: live health probe failed, treating as off-air",
            health_url=source.health_url,
            error=str(exc),
        )
        return None

    if not isinstance(payload, dict) or payload.get("live") is not True:
        return None

    started_at = payload.get("started_at")
    return LiveBroadcast(
        stream_url=source.stream_url,
        kind=source.kind,
        started_at=started_at if isinstance(started_at, str) else None,
    )


def reset_cache() -> None:
    """Drop memoized liveness — tests only."""
    _cache.clear()
