"""content moderation api endpoints."""

import logging
from enum import Enum
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from backend._internal import Session, require_auth
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


class ReportReason(str, Enum):
    """valid reasons for content reports."""

    COPYRIGHT = "copyright"
    ABUSE = "abuse"
    SPAM = "spam"
    EXPLICIT = "explicit"
    OTHER = "other"


class CreateReportRequest(BaseModel):
    """request to create a content report."""

    target_type: Literal["track", "artist", "album", "playlist", "tag", "comment"]
    target_id: str = Field(..., min_length=1, max_length=100)
    reason: ReportReason
    description: str | None = Field(None, max_length=1000)
    screenshot_url: str | None = Field(None, max_length=500)


class CreateReportResponse(BaseModel):
    """response after creating a report."""

    report_id: int


@router.post("/reports")
@limiter.limit("10/hour")
async def create_report(
    request: Request,
    body: CreateReportRequest,
    session: Session = Depends(require_auth),
) -> CreateReportResponse:
    """submit a content report.

    requires authentication. rate limited to 10 reports per hour per user.
    the report is forwarded to the moderation service for storage and
    admin review.
    """
    client = get_moderation_client()

    try:
        result = await client.create_report(
            reporter_did=session.did,
            target_type=body.target_type,
            target_id=body.target_id,
            reason=body.reason.value,
            description=body.description,
            screenshot_url=body.screenshot_url,
        )
        return CreateReportResponse(report_id=result.report_id)
    except Exception as e:
        logger.exception("failed to create report: %s", e)
        raise HTTPException(status_code=500, detail="failed to submit report") from e


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
