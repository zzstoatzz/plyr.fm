"""resolve who a sign-in is for and where the OAuth redirect will land."""

import asyncio
import logging
from urllib.parse import urlparse

import httpx
from atproto import AsyncIdResolver
from atproto_oauth.client import discover_authserver_from_pds_async
from pydantic import BaseModel

logger = logging.getLogger(__name__)

_resolver = AsyncIdResolver()

BSKY_PROFILE_URL = "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile"


class SignInPreview(BaseModel):
    """an account plus the host its OAuth sign-in happens on."""

    did: str
    handle: str
    display_name: str
    avatar_url: str | None
    sign_in_host: str | None


async def _fetch_profile(did: str) -> dict[str, str | None]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(BSKY_PROFILE_URL, params={"actor": did})
        if r.status_code == 200:
            data = r.json()
            return {
                "display_name": data.get("displayName"),
                "avatar": data.get("avatar"),
            }
    except httpx.HTTPError as e:
        logger.info(f"sign-in preview: profile fetch failed for {did}: {e}")
    return {"display_name": None, "avatar": None}


async def _sign_in_host(pds_url: str | None) -> str | None:
    if not pds_url:
        return None
    try:
        authserver = await discover_authserver_from_pds_async(pds_url.rstrip("/"))
    except (httpx.HTTPError, ValueError) as e:
        logger.info(f"sign-in preview: authserver discovery failed for {pds_url}: {e}")
        return None
    return urlparse(authserver).hostname


async def resolve_sign_in_preview(identifier: str) -> SignInPreview | None:
    """resolve a handle or DID to its profile and authorization server host.

    returns None when the identifier doesn't resolve to an account. a missing
    profile or undiscoverable authserver degrades to null fields instead.
    """
    value = identifier.strip().removeprefix("at://").removeprefix("@")
    if not value:
        return None

    try:
        did = (
            value if value.startswith("did:") else await _resolver.handle.resolve(value)
        )
        if not did:
            return None
        doc = await _resolver.did.resolve(did)
    except Exception as e:
        logger.info(f"sign-in preview: could not resolve {value}: {e}")
        return None
    if doc is None:
        return None

    handle = (
        value.lower() if not value.startswith("did:") else (doc.get_handle() or did)
    )
    profile, host = await asyncio.gather(
        _fetch_profile(did), _sign_in_host(doc.get_pds_endpoint())
    )
    return SignInPreview(
        did=did,
        handle=handle,
        display_name=profile["display_name"] or handle,
        avatar_url=profile["avatar"],
        sign_in_host=host,
    )
