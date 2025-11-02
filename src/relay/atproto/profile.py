"""Bluesky profile discovery utilities."""

import logging

import httpx

logger = logging.getLogger(__name__)

BSKY_API_BASE = "https://public.api.bsky.app/xrpc"


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
                    return avatar
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
