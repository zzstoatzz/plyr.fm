"""content moderation api endpoints."""

import logging

from fastapi import APIRouter, Request
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


@router.get("/sensitive-images")
@limiter.limit("120/minute")
async def get_sensitive_images(
    request: Request,
) -> SensitiveImagesResponse:
    """get all flagged sensitive images.

    proxies to the moderation service which is the source of truth
    for sensitive image data.

    returns both image_ids (for R2-stored images) and full URLs
    (for external images like avatars). clients should check both.
    """
    client = get_moderation_client()
    result = await client.get_sensitive_images()

    return SensitiveImagesResponse(
        image_ids=result.image_ids,
        urls=result.urls,
    )
