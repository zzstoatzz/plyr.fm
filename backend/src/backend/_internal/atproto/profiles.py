"""DID-keyed profile resolver with caching.

featured artists (and any other place that needs to render an identity)
are stored as DIDs only — the canonical, immutable identifier. handle,
display_name, and avatar_url are mutable properties of the profile that
should be resolved fresh at read time rather than snapshotted into the
record.

resolution order, cheapest-first:
1. local `artists` table — covers every plyr.fm user. one SQL hit, batched.
2. in-process LRU cache — for DIDs we've seen recently but aren't plyr.fm users.
3. live bsky `app.bsky.actor.getProfile` — fallback for cold cache misses.

use `resolve_dids()` for any number of DIDs — it issues at most one SQL
query for the artists JOIN and parallelizes bsky fallbacks for cold
cache misses.

DIDs that cannot be resolved (network failure, bsky returns non-200, no
profile exists) are simply omitted from the result. callers must not
assume `len(out) == len(input)`. for the featured-artist render path
this is the right shape: a featured artist whose profile we can't load
is better not shown than shown as a placeholder DID string.
"""

import asyncio
import logging
import time
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Artist
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ResolvedProfile:
    """current profile snapshot for a DID, hydrated at resolve time."""

    did: str
    handle: str
    display_name: str
    avatar_url: str | None


# in-process cache for non-plyr.fm DIDs. plyr.fm users come from the
# artists table on every call (cheap JOIN), so caching them risks
# serving stale display_name/avatar after a profile update.
_CACHE_TTL_SECONDS = 300  # 5 minutes
_CACHE_MAX_SIZE = 2048

_cache: dict[str, tuple[float, ResolvedProfile]] = {}


def _cache_get(did: str) -> ResolvedProfile | None:
    entry = _cache.get(did)
    if entry is None:
        return None
    expires_at, profile = entry
    if expires_at < time.monotonic():
        _cache.pop(did, None)
        return None
    return profile


def _cache_set(did: str, profile: ResolvedProfile) -> None:
    if len(_cache) >= _CACHE_MAX_SIZE:
        # cheap eviction: drop the oldest 256 by insertion order
        for k in list(_cache.keys())[:256]:
            _cache.pop(k, None)
    _cache[did] = (time.monotonic() + _CACHE_TTL_SECONDS, profile)


async def _fetch_from_bsky(
    client: httpx.AsyncClient, did: str
) -> ResolvedProfile | None:
    """fetch a single profile from bsky's public appview.

    returns None if the profile can't be resolved — caller should drop
    the DID from the rendered list rather than display a placeholder.
    """
    try:
        response = await client.get(
            "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
            params={"actor": did},
            timeout=5.0,
        )
        if response.status_code != 200:
            logger.debug(
                "bsky getProfile non-200 for %s: %d", did, response.status_code
            )
            return None
        data = response.json()
        handle = data.get("handle")
        if not handle:
            return None
        return ResolvedProfile(
            did=did,
            handle=handle,
            display_name=data.get("displayName") or handle,
            avatar_url=data.get("avatar"),
        )
    except (httpx.HTTPError, ValueError) as exc:
        logger.debug("bsky getProfile failed for %s: %s", did, exc)
        return None


async def _from_artist_row(artist: Artist) -> ResolvedProfile:
    return ResolvedProfile(
        did=artist.did,
        handle=artist.handle,
        display_name=artist.display_name,
        avatar_url=artist.avatar_url,
    )


async def _load_artists_by_did(db: AsyncSession, dids: list[str]) -> dict[str, Artist]:
    if not dids:
        return {}
    result = await db.execute(select(Artist).where(Artist.did.in_(dids)))
    return {artist.did: artist for artist in result.scalars().all()}


async def resolve_dids(dids: list[str]) -> list[ResolvedProfile]:
    """resolve a batch of DIDs to profiles, preserving input order.

    duplicates in the input list are deduplicated for resolution and
    re-projected back into the result so callers don't have to think
    about it.
    """
    if not dids:
        return []

    unique = list(dict.fromkeys(dids))  # preserve order, dedupe

    resolved: dict[str, ResolvedProfile] = {}

    # step 1: artists table
    async with db_session() as db:
        artists = await _load_artists_by_did(db, unique)
    for did, artist in artists.items():
        resolved[did] = await _from_artist_row(artist)

    # step 2: in-process cache for the rest
    remaining = [did for did in unique if did not in resolved]
    for did in list(remaining):
        cached = _cache_get(did)
        if cached is not None:
            resolved[did] = cached
            remaining.remove(did)

    # step 3: bsky fallback for cold misses
    if remaining:
        async with httpx.AsyncClient() as client:
            fetched = await asyncio.gather(
                *[_fetch_from_bsky(client, did) for did in remaining]
            )
        for profile in fetched:
            if profile is not None:
                resolved[profile.did] = profile
                _cache_set(profile.did, profile)

    # preserve input order; drop unresolvable DIDs (see module docstring)
    return [resolved[did] for did in dids if did in resolved]
