"""ATProto handle resolution for featured artists."""

import httpx
import logging

logger = logging.getLogger(__name__)


async def resolve_handle(handle: str) -> dict | None:
    """resolve ATProto handle to DID and profile info.

    args:
        handle: ATProto handle (e.g., "user.bsky.social" or "@user.bsky.social")

    returns:
        dict with {did, handle, display_name, avatar_url} or None if not found
    """
    # normalize handle (remove @ if present)
    handle = handle.lstrip("@")

    try:
        async with httpx.AsyncClient() as client:
            # resolve handle to DID
            did_response = await client.get(
                "https://bsky.social/xrpc/com.atproto.identity.resolveHandle",
                params={"handle": handle},
                timeout=5.0,
            )

            if did_response.status_code != 200:
                logger.warning(f"failed to resolve handle {handle}: {did_response.status_code}")
                return None

            did = did_response.json()["did"]

            # fetch profile info
            profile_response = await client.get(
                "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
                params={"actor": did},
                timeout=5.0,
            )

            if profile_response.status_code != 200:
                logger.warning(f"failed to fetch profile for {did}: {profile_response.status_code}")
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
                logger.warning(f"search failed for query {query}: {response.status_code}")
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
