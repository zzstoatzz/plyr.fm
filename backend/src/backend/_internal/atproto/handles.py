"""ATProto handle resolution for featured artists."""

import logging
from typing import Any

import httpx
from atproto import AsyncIdResolver

logger = logging.getLogger(__name__)

# shared resolver instance for DID/handle resolution
_resolver = AsyncIdResolver()


async def resolve_handle(handle: str) -> dict[str, Any] | None:
    """resolve ATProto handle to DID and profile info.

    args:
        handle: ATProto handle (e.g., "user.bsky.social" or "@user.bsky.social")

    returns:
        dict with {did, handle, display_name, avatar_url} or None if not found
    """
    # normalize handle (remove @ if present)
    handle = handle.lstrip("@")

    try:
        # use ATProto SDK for proper handle resolution (works with any PDS)
        did = await _resolver.handle.resolve(handle)

        if not did:
            logger.warning(f"failed to resolve handle {handle}: no DID found")
            return None

        # fetch profile info from Bluesky appview (for display name/avatar)
        # this is acceptable since we're fetching Bluesky profile data specifically
        async with httpx.AsyncClient() as client:
            profile_response = await client.get(
                "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
                params={"actor": did},
                timeout=5.0,
            )

            if profile_response.status_code != 200:
                logger.warning(
                    f"failed to fetch profile for {did}: {profile_response.status_code}"
                )
                # return basic info even if profile fetch fails
                return {
                    "did": did,
                    "handle": handle,
                    "display_name": handle,
                    "avatar_url": None,
                }

            profile = profile_response.json()
            return {
                "did": did,
                "handle": handle,
                "display_name": profile.get("displayName") or handle,
                "avatar_url": profile.get("avatar"),
            }

    except httpx.TimeoutException:
        logger.error(f"timeout resolving handle {handle}")
        return None
    except Exception as e:
        logger.error(f"error resolving handle {handle}: {e}", exc_info=True)
        return None


async def resolve_featured_artists(
    features_json: str | None,
    exclude_handle: str,
) -> list[dict]:
    """resolve featured artist handles from JSON array.

    args:
        features_json: JSON array string of handles, e.g., '["user1.bsky.social"]'
        exclude_handle: handle to exclude (typically the uploading artist)

    returns:
        list of resolved artist dicts, excluding failures and the uploader
    """
    if not features_json:
        return []

    import asyncio
    import json

    try:
        handles_list = json.loads(features_json)
    except json.JSONDecodeError:
        logger.warning(
            "malformed features JSON, ignoring", extra={"raw": features_json}
        )
        return []

    if not isinstance(handles_list, list):
        return []

    # filter valid handles, excluding the uploading artist
    valid_handles = [
        handle
        for handle in handles_list
        if isinstance(handle, str) and handle.lstrip("@") != exclude_handle
    ]

    if not valid_handles:
        return []

    # resolve concurrently
    resolved = await asyncio.gather(
        *[resolve_handle(h) for h in valid_handles],
        return_exceptions=True,
    )

    # filter out exceptions and None values
    return [r for r in resolved if isinstance(r, dict) and r is not None]


async def search_handles(query: str, limit: int = 10) -> list[dict]:
    """search for ATProto handles by prefix.

    args:
        query: search query (handle prefix)
        limit: max results to return (default 10)

    returns:
        list of {did, handle, display_name, avatar_url}
    """
    if not query or len(query) < 2:
        return []

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead",
                params={"q": query, "limit": min(limit, 25)},
                timeout=5.0,
            )

            if response.status_code != 200:
                logger.warning(
                    f"search failed for query {query}: {response.status_code}"
                )
                return []

            actors = response.json().get("actors", [])
            return [
                {
                    "did": actor["did"],
                    "handle": actor["handle"],
                    "display_name": actor.get("displayName") or actor["handle"],
                    "avatar_url": actor.get("avatar"),
                }
                for actor in actors
            ]

    except httpx.TimeoutException:
        logger.error(f"timeout searching for {query}")
        return []
    except Exception as e:
        logger.error(f"error searching for {query}: {e}", exc_info=True)
        return []
