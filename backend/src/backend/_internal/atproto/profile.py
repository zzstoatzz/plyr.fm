"""Bluesky profile discovery utilities."""

import logging
from urllib.parse import parse_qs, urlparse

import httpx

logger = logging.getLogger(__name__)

BSKY_API_BASE = "https://public.api.bsky.app/xrpc"


def normalize_avatar_url(url: str | None) -> str | None:
    """normalize avatar URL to use Bluesky CDN if possible.

    converts raw PDS blob URLs to CDN URLs to avoid SSL/availability issues
    with self-hosted PDS instances.

    args:
        url: original avatar URL

    returns:
        normalized URL or original URL
    """
    if not url:
        return None

    # if it's already a CDN URL, return it
    if "cdn.bsky.app" in url:
        return url

    # check if it's a raw PDS blob URL
    # format: https://{pds}/xrpc/com.atproto.sync.getBlob?did={did}&cid={cid}
    if "com.atproto.sync.getBlob" in url:
        try:
            parsed = urlparse(url)
            query = parse_qs(parsed.query)
            did = query.get("did", [None])[0]
            cid = query.get("cid", [None])[0]

            if did and cid:
                # default to jpeg as it's most common/safe for avatars
                # @jpeg suffix hints CDN to serve/convert as jpeg
                return f"https://cdn.bsky.app/img/avatar/plain/{did}/{cid}@jpeg"
        except Exception:
            # if parsing fails, return original URL
            pass

    return url


async def fetch_user_avatar(did: str) -> str | None:
    """fetch user avatar URL from Bluesky public API.

    args:
        did: ATProto DID (e.g., "did:plc:...")

    returns:
        avatar URL if found, None otherwise
    """
    profile_url = f"{BSKY_API_BASE}/app.bsky.actor.getProfile?actor={did}"

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(profile_url, timeout=10.0)

            if response.status_code == 200:
                profile_data = response.json()
                avatar = profile_data.get("avatar")

                if avatar:
                    logger.info(f"discovered avatar for {did}: {avatar}")
                    return normalize_avatar_url(avatar)
                else:
                    logger.info(f"no avatar found for {did}")
                    return None
            else:
                logger.warning(
                    f"failed to fetch profile for {did}: {response.status_code}"
                )
                return None

    except Exception as e:
        logger.error(f"error fetching avatar for {did}: {e}", exc_info=True)
        return None


async def fetch_user_profile(did: str) -> dict | None:
    """fetch full user profile from Bluesky public API.

    args:
        did: ATProto DID (e.g., "did:plc:...")

    returns:
        profile dict if found, None otherwise
    """
    profile_url = f"{BSKY_API_BASE}/app.bsky.actor.getProfile?actor={did}"

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(profile_url, timeout=10.0)

            if response.status_code == 200:
                profile_data = response.json()
                logger.info(
                    f"discovered profile for {did}: {profile_data.get('handle')}"
                )
                return profile_data
            else:
                logger.warning(
                    f"failed to fetch profile for {did}: {response.status_code}"
                )
                return None

    except Exception as e:
        logger.error(f"error fetching profile for {did}: {e}", exc_info=True)
        return None
