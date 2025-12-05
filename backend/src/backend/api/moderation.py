"""content moderation api endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import SensitiveImage, get_db

router = APIRouter(prefix="/moderation", tags=["moderation"])


class SensitiveImagesResponse(BaseModel):
    """list of sensitive image identifiers."""

    # R2 image IDs (for track/album artwork)
    image_ids: list[str]
    # full URLs (for external images like avatars)
    urls: list[str]


@router.get("/sensitive-images")
async def get_sensitive_images(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SensitiveImagesResponse:
    """get all flagged sensitive images.

    returns both image_ids (for R2-stored images) and full URLs
    (for external images like avatars). clients should check both.
    """
    result = await db.execute(select(SensitiveImage))
    images = result.scalars().all()

    image_ids = [img.image_id for img in images if img.image_id]
    urls = [img.url for img in images if img.url]

    return SensitiveImagesResponse(image_ids=image_ids, urls=urls)
