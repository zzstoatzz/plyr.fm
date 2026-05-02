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

callers should prefer `resolve_dids()` (batched) over `resolve_did()`
when hydrating a list. the batched path issues at most one SQL query and
parallelizes any bsky fallbacks.
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


def _placeholder_profile(did: str) -> ResolvedProfile:
    """fallback when bsky lookup fails — use the DID as the display string.

    avoids returning None to callers; UI prefers to show *something* over
    a missing entry. callers can detect this by checking handle == did.
    """
    return ResolvedProfile(
        did=did,
        handle=did,
        display_name=did,
        avatar_url=None,
    )


async def _fetch_from_bsky(client: httpx.AsyncClient, did: str) -> ResolvedProfile:
    """fetch a single profile from bsky's public appview."""
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
            return _placeholder_profile(did)
        data = response.json()
        return ResolvedProfile(
            did=did,
            handle=data.get("handle") or did,
            display_name=data.get("displayName") or data.get("handle") or did,
            avatar_url=data.get("avatar"),
        )
    except (httpx.HTTPError, ValueError) as exc:
        logger.debug("bsky getProfile failed for %s: %s", did, exc)
        return _placeholder_profile(did)


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
            resolved[profile.did] = profile
            _cache_set(profile.did, profile)

    return [resolved[did] for did in dids]


async def resolve_did(did: str) -> ResolvedProfile:
    """resolve a single DID to a profile. shorthand over `resolve_dids`."""
    [profile] = await resolve_dids([did])
    return profile
