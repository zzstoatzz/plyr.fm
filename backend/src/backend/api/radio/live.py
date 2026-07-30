"""Is a station's broadcast airing right now?

Polled server-side rather than from each client: the answer is identical for
everyone, so one request per cache window covers the whole audience instead of
pointing every listener at the broadcaster's origin.

Fails closed. A broadcaster we cannot reach is treated as off-air, so the
station falls back to its rotation rather than handing clients a stream URL that
will not load — dead air is the one outcome radio must never produce.
"""

import asyncio
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx
import logfire

from backend.api.radio.stations import LiveSource

# how long a liveness answer is reused. short enough that going on or off air
# is noticed promptly, long enough that the broadcaster sees a trickle.
_CACHE_TTL_SECONDS = 5.0
_PROBE_TIMEOUT_SECONDS = 3.0
# how stale the newest segment may be before the stream counts as stopped.
# generous next to a typical 4s segment: a slow encoder tick is not an outage.
_SEGMENT_FRESHNESS_SECONDS = 45.0
_PROGRAM_DATE_TIME = re.compile(r"^#EXT-X-PROGRAM-DATE-TIME:(.+)$", re.MULTILINE)


@dataclass(frozen=True)
class LiveBroadcast:
    """A broadcast confirmed to be airing."""

    stream_url: str
    kind: str
    started_at: str | None
    artwork_url: str | None = None


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

    if not isinstance(payload, dict):
        return None

    def _str(key: str) -> str | None:
        value = payload.get(key)
        return value if isinstance(value, str) and value else None

    if payload.get("live") is not True:
        # a broadcaster can report itself down while its playlist keeps
        # advancing — observed 2026-07-30, stream healthy and `live: false`.
        # the playlist is what a listener actually plays, so it gets the last
        # word before we tell anyone the station is off air.
        if not await _playlist_is_advancing(source.stream_url):
            return None
        logfire.info(
            "radio: broadcaster reports down but its playlist is live, airing it",
            health_url=source.health_url,
        )

    return LiveBroadcast(
        stream_url=source.stream_url,
        kind=source.kind,
        started_at=_str("started_at"),
        # the broadcaster owns its own artwork — a sonification renders a cover
        # per interval, so this changes while the stream stays put.
        artwork_url=_str("artwork_url"),
    )


async def _playlist_is_advancing(playlist_url: str) -> bool:
    """is the stream still producing segments?

    Ground truth for "can someone hear this right now" is the playlist, not a
    status field beside it. A live playlist carries no ENDLIST and stamps each
    segment with a wall-clock time; if the newest one is recent, audio exists.
    """
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT_SECONDS) as client:
            response = await client.get(playlist_url)
            response.raise_for_status()
            body = response.text
    except Exception:
        return False

    if "#EXT-X-ENDLIST" in body:
        return False  # the broadcaster closed the stream out
    stamps = _PROGRAM_DATE_TIME.findall(body)
    if not stamps:
        return False
    try:
        newest = datetime.fromisoformat(stamps[-1].strip().replace("Z", "+00:00"))
    except ValueError:
        return False
    if newest.tzinfo is None:
        newest = newest.replace(tzinfo=UTC)
    age = (datetime.now(UTC) - newest).total_seconds()
    return age <= _SEGMENT_FRESHNESS_SECONDS


def reset_cache() -> None:
    """Drop memoized liveness — tests only."""
    _cache.clear()
