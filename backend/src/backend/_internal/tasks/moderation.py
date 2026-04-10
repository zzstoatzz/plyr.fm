"""background tasks for image moderation.

image moderation was previously awaited inline during track/album PATCH
requests, blocking the HTTP response for ~3-6s while the moderation
service ran claude vision. moving to a docket task makes the response
instantaneous while still flagging unsafe images.
"""

import logging

import httpx
import logfire

from backend._internal.background import get_docket
from backend._internal.clients.moderation import get_moderation_client
from backend._internal.notifications import notification_service

logger = logging.getLogger(__name__)


async def scan_image_moderation(
    image_id: str,
    image_url: str,
    content_type: str,
    entity_type: str,
) -> None:
    """download the image from R2 and scan it for policy violations.

    called as a docket background task after the image has been stored.
    fetches the image bytes from its public URL (already on R2 CDN) and
    sends them to the moderation service. if the image is flagged, fires
    a notification — same behavior as the old inline path, just not
    blocking the user's request.
    """
    try:
        # fetch the image bytes from R2 (public URL, no auth needed)
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as http:
            response = await http.get(image_url)
            response.raise_for_status()
            image_bytes = response.content

        client = get_moderation_client()
        result = await client.scan_image(image_bytes, image_id, content_type)

        if not result.is_safe:
            await notification_service.send_image_flag_notification(
                image_id=image_id,
                severity=result.severity,
                categories=result.violated_categories,
                context=f"{entity_type} cover",
            )

        logfire.info(
            "background image moderation complete",
            image_id=image_id,
            is_safe=result.is_safe,
            severity=result.severity,
        )
    except Exception as e:
        logger.warning("background image moderation failed for %s: %s", image_id, e)


async def schedule_image_moderation_scan(
    *,
    image_id: str,
    image_url: str,
    content_type: str,
    entity_type: str,
) -> None:
    """schedule an image moderation scan via docket."""
    docket = get_docket()
    await docket.add(scan_image_moderation)(
        image_id, image_url, content_type, entity_type
    )
    logfire.info("scheduled image moderation scan", image_id=image_id)
