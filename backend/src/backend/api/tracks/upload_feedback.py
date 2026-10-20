"""Private feedback from accounts whose uploads are paused."""

import logging
from typing import Annotated

from fastapi import BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.notifications import notification_service
from backend._internal.upload_policy import upload_pause_message
from backend.models import UploadFeedback, get_db
from backend.utilities.rate_limit import limiter

from .router import router

logger = logging.getLogger(__name__)


class UploadFeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
    ]


class UploadFeedbackResponse(BaseModel):
    id: int


async def notify_upload_feedback(
    feedback_id: int, handle: str | None, message: str
) -> None:
    try:
        await notification_service.send_upload_feedback_notification(
            feedback_id, handle, message
        )
    except Exception:
        logger.warning("upload feedback notification failed for %s", feedback_id)


@router.post("/me/upload-feedback", status_code=201)
@limiter.limit("3/hour")
async def submit_upload_feedback(
    request: Request,
    body: UploadFeedbackRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> UploadFeedbackResponse:
    if upload_pause_message(session.did) is None:
        raise HTTPException(
            status_code=403, detail="uploads are not paused on this account"
        )
    feedback = UploadFeedback(
        did=session.did, handle=session.handle, message=body.message
    )
    db.add(feedback)
    await db.commit()
    await db.refresh(feedback)
    background_tasks.add_task(
        notify_upload_feedback, feedback.id, session.handle, feedback.message
    )
    return UploadFeedbackResponse(id=feedback.id)
