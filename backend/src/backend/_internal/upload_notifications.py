"""Operator DMs for encounters with the temporary upload pause."""

import logging
from datetime import UTC, datetime, timedelta

import anyio
from docket import ExponentialRetry

from backend._internal.background import get_docket
from backend._internal.notifications import notification_service
from backend.models import Artist, UploadFeedback
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)
_NOTIFICATION_RETRY = ExponentialRetry(
    attempts=4,
    minimum_delay=timedelta(seconds=30),
    maximum_delay=timedelta(minutes=10),
)


async def deliver_upload_pause_notification(
    did: str,
    handle: str | None,
    event: str,
    detail: str,
    occurred_at: str,
    retry: ExponentialRetry = _NOTIFICATION_RETRY,
) -> None:
    if handle is None:
        async with db_session() as db:
            artist = await db.get(Artist, did)
            handle = artist.handle if artist else None
    result = await notification_service.send_upload_pause_notification(
        did, handle, event, detail, occurred_at
    )
    if result is None or not result.success:
        raise RuntimeError("upload pause DM delivery failed")


async def deliver_upload_feedback_notification(
    feedback_id: int,
    retry: ExponentialRetry = _NOTIFICATION_RETRY,
) -> None:
    async with db_session() as db:
        feedback = await db.get(UploadFeedback, feedback_id)
        if feedback is None:
            return
        handle, message, did = feedback.handle, feedback.message, feedback.did
    result = await notification_service.send_upload_feedback_notification(
        feedback_id, handle, message, did
    )
    if result is None or not result.success:
        raise RuntimeError("upload feedback DM delivery failed")


async def schedule_upload_pause_notification(
    did: str, handle: str | None, event: str, detail: str = ""
) -> None:
    occurred_at = datetime.now(UTC).isoformat()
    detail = detail[:500]
    try:
        with anyio.fail_after(2):
            await get_docket().add(deliver_upload_pause_notification)(
                did, handle, event, detail, occurred_at
            )
    except Exception:
        logger.warning(
            "could not queue upload pause DM for %s; trying direct delivery", did
        )
        try:
            with anyio.fail_after(5):
                await deliver_upload_pause_notification(
                    did, handle, event, detail, occurred_at
                )
        except Exception:
            logger.exception("upload pause DM fallback failed for %s", did)


async def schedule_upload_feedback_notification(feedback_id: int) -> None:
    try:
        with anyio.fail_after(2):
            await get_docket().add(deliver_upload_feedback_notification)(feedback_id)
    except Exception:
        logger.warning(
            "could not queue upload feedback DM for %s; trying direct delivery",
            feedback_id,
        )
        try:
            with anyio.fail_after(5):
                await deliver_upload_feedback_notification(feedback_id)
        except Exception:
            logger.exception("upload feedback DM fallback failed for %s", feedback_id)
