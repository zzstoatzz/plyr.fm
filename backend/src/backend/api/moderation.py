"""content moderation api endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import ExplicitImage, get_db

router = APIRouter(prefix="/moderation", tags=["moderation"])


class ExplicitImagesResponse(BaseModel):
    """list of explicit image identifiers."""

    # R2 image IDs (for track/album artwork)
    image_ids: list[str]
    # full URLs (for external images like avatars)
    urls: list[str]


@router.get("/explicit-images")
async def get_explicit_images(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ExplicitImagesResponse:
    """get all flagged explicit images.

    returns both image_ids (for R2-stored images) and full URLs
    (for external images like avatars). clients should check both.
    """
    result = await db.execute(select(ExplicitImage))
    images = result.scalars().all()

    image_ids = [img.image_id for img in images if img.image_id]
    urls = [img.url for img in images if img.url]

    return ExplicitImagesResponse(image_ids=image_ids, urls=urls)
