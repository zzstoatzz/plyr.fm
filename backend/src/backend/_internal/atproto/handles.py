"""ATProto handle → DID resolution and featured-artist input parsing."""

import asyncio
import json
import logging
from typing import Any

import httpx
from atproto import AsyncIdResolver

logger = logging.getLogger(__name__)

# shared resolver instance for DID/handle resolution
_resolver = AsyncIdResolver()

# upper bound on featured-artist count per track. the lexicon allows up
# to 10 (`maxLength: 10`); we enforce a stricter app-level cap.
MAX_FEATURES = 5


class InvalidFeaturesError(ValueError):
    """user-supplied featured-artists JSON is malformed or unresolvable."""


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
    *,
    exclude_handle: str,
) -> list[dict[str, str]]:
    """parse a JSON handle list and resolve each to a DID.

    args:
        features_json: JSON array of handle strings, e.g.,
            `'["user.bsky.social", "@other.user"]'`. empty or None → `[]`.
        exclude_handle: handle to drop from the result (the uploading artist).

    returns:
        `[{"did": "did:plc:..."}, ...]`.

    raises:
        InvalidFeaturesError: malformed JSON, non-list, non-string entries,
            over MAX_FEATURES, or any handle fails to resolve.
    """
    if not features_json:
        return []

    try:
        handles_list = json.loads(features_json)
    except json.JSONDecodeError as exc:
        raise InvalidFeaturesError(f"invalid JSON in features: {exc}") from exc

    if not isinstance(handles_list, list):
        raise InvalidFeaturesError("features must be a JSON array of handles")

    if len(handles_list) > MAX_FEATURES:
        raise InvalidFeaturesError(f"maximum {MAX_FEATURES} featured artists allowed")

    valid_handles: list[str] = []
    for handle in handles_list:
        if not isinstance(handle, str):
            raise InvalidFeaturesError("each feature must be a string handle")
        if handle.lstrip("@") == exclude_handle:
            continue
        valid_handles.append(handle)

    if not valid_handles:
        return []

    resolved = await asyncio.gather(
        *[resolve_handle(h) for h in valid_handles],
        return_exceptions=True,
    )

    out: list[dict[str, str]] = []
    for handle, r in zip(valid_handles, resolved, strict=False):
        if isinstance(r, Exception) or not isinstance(r, dict) or not r.get("did"):
            raise InvalidFeaturesError(f"failed to resolve handle: {handle}")
        out.append({"did": r["did"]})

    return out
