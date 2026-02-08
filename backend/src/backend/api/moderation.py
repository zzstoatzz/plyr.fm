"""content moderation api endpoints."""

import logging
from enum import Enum
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from backend._internal import Session, require_auth
from backend._internal.clients.moderation import get_moderation_client
from backend._internal.notifications import notification_service
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
    target_name: str | None = Field(None, max_length=200)
    target_url: str | None = Field(None, max_length=200)
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
            reporter_handle=session.handle,
            target_type=body.target_type,
            target_id=body.target_id,
            target_name=body.target_name,
            target_url=body.target_url,
            reason=body.reason.value,
            description=body.description,
            screenshot_url=body.screenshot_url,
        )

        # notify admin via DM (fire and forget - don't block on failure)
        try:
            await notification_service.send_user_report_notification(
                report_id=result.report_id,
                reporter_handle=session.handle,
                target_type=body.target_type,
                target_name=body.target_name,
                target_url=body.target_url,
                reason=body.reason.value,
                description=body.description,
            )
        except Exception as notify_err:
            logger.warning("failed to send report notification: %s", notify_err)

        return CreateReportResponse(report_id=result.report_id)
    except httpx.HTTPStatusError as e:
        logger.error(
            "moderation service error: %s %s", e.response.status_code, e.response.text
        )
        if e.response.status_code in (401, 403):
            # auth misconfiguration between backend and moderation service
            raise HTTPException(
                status_code=503, detail="moderation service unavailable"
            ) from e
        if e.response.status_code == 404:
            raise HTTPException(
                status_code=503, detail="moderation service endpoint not found"
            ) from e
        # propagate other client errors (4xx) as bad request
        if 400 <= e.response.status_code < 500:
            raise HTTPException(status_code=400, detail="invalid report request") from e
        # server errors from moderation service
        raise HTTPException(status_code=503, detail="moderation service error") from e
    except httpx.TimeoutException as e:
        logger.error("moderation service timeout: %s", e)
        raise HTTPException(status_code=503, detail="moderation service timeout") from e
    except Exception as e:
        logger.exception("unexpected error creating report: %s", e)
        raise HTTPException(status_code=500, detail="internal error") from e


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
