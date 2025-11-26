"""client for constellation atproto backlink index.

constellation indexes backlinks across the atproto network, enabling
queries like "how many likes does this track have?" across all apps,
not just plyr.fm.

public instance: https://constellation.microcosm.blue
source: https://github.com/at-microcosm/microcosm-rs/tree/main/constellation
"""

import logging

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)

CONSTELLATION_URL = "https://constellation.microcosm.blue"


async def get_like_count(target_uri: str) -> int:
    """get network-wide like count for a target record.

    queries constellation's backlink index for all fm.plyr.like records
    pointing to the target URI.

    args:
        target_uri: the at:// URI of the record to count likes for

    returns:
        total like count from across the atproto network
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{CONSTELLATION_URL}/links/count",
            params={
                "target": target_uri,
                "collection": settings.atproto.like_collection,
                "path": ".subject.uri",
            },
        )
        resp.raise_for_status()
        return resp.json()["count"]


async def get_like_count_safe(target_uri: str, fallback: int = 0) -> int:
    """get like count with fallback on error.

    use this when you don't want constellation failures to break the request.
    """
    try:
        return await get_like_count(target_uri)
    except Exception as e:
        logger.warning(f"constellation query failed for {target_uri}: {e}")
        return fallback
