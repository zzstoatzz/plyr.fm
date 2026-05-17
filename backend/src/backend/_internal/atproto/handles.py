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


async def _resolve_handle_to_did(handle: str) -> str | None:
    """resolve handle → DID via SDK, falling back to the AppView XRPC.

    the SDK hits `<handle>/.well-known/atproto-did` first; Cloudflare in
    front of `*.bsky.social` has been observed returning 403 to that path
    from certain egress IPs while `public.api.bsky.app` (a different host)
    still resolves the same handle. the XRPC fallback rescues those flows.
    """
    try:
        did = await _resolver.handle.resolve(handle)
        if did:
            return did
        logger.warning(f"SDK returned no DID for {handle}; trying AppView XRPC")
    except Exception as e:
        logger.warning(f"SDK handle resolution failed for {handle}: {e}; trying AppView XRPC")

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle",
                params={"handle": handle},
                timeout=5.0,
            )
        if resp.status_code == 200:
            return resp.json().get("did")
        logger.warning(f"AppView XRPC returned {resp.status_code} for {handle}")
    except Exception as e:
        logger.warning(f"AppView handle resolution failed for {handle}: {e}")

    return None


async def resolve_handle(handle: str) -> dict[str, Any] | None:
    """resolve ATProto handle to DID and profile info.

    args:
        handle: ATProto handle (e.g., "user.bsky.social" or "@user.bsky.social")

    returns:
        dict with {did, handle, display_name, avatar_url} or None if not found
    """
    handle = handle.lstrip("@")

    did = await _resolve_handle_to_did(handle)
    if not did:
        logger.warning(f"failed to resolve handle {handle}: no DID found")
        return None

    try:
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
        logger.error(f"timeout fetching profile for {did}")
        return {"did": did, "handle": handle, "display_name": handle, "avatar_url": None}
    except Exception as e:
        logger.error(f"error fetching profile for {did}: {e}", exc_info=True)
        return {"did": did, "handle": handle, "display_name": handle, "avatar_url": None}


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
