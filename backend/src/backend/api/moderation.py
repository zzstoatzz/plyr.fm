"""content moderation api endpoints."""

import logging

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from backend._internal.moderation_client import get_moderation_client
from backend.utilities.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/moderation", tags=["moderation"])


class SensitiveImagesResponse(BaseModel):
    """list of sensitive image identifiers."""

    # R2 image IDs (for track/album artwork)
    image_ids: list[str]
    # full URLs (for external images like avatars)
    urls: list[str]


# cache TTLs for sensitive images endpoint
# edge (CDN) caches for 5 minutes, browser caches for 1 minute
# this data changes rarely (only when admins flag new images)
SENSITIVE_IMAGES_CACHE_CONTROL = "public, s-maxage=300, max-age=60"


@router.get("/sensitive-images")
@limiter.limit("120/minute")
async def get_sensitive_images(
    request: Request,
    response: Response,
) -> SensitiveImagesResponse:
    """get all flagged sensitive images.

    proxies to the moderation service which is the source of truth
    for sensitive image data.

    returns both image_ids (for R2-stored images) and full URLs
    (for external images like avatars). clients should check both.

    cached at edge (5 min) and browser (1 min) to reduce load from
    SSR page loads hitting this endpoint on every request.
    """
    response.headers["Cache-Control"] = SENSITIVE_IMAGES_CACHE_CONTROL
    client = get_moderation_client()
    result = await client.get_sensitive_images()

    return SensitiveImagesResponse(
        image_ids=result.image_ids,
        urls=result.urls,
    )
