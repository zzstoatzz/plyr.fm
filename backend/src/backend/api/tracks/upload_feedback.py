"""Private feedback from accounts whose uploads are paused."""

from typing import Annotated

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.upload_notifications import schedule_upload_feedback_notification
from backend._internal.upload_policy import upload_pause_message
from backend.models import UploadFeedback, get_db
from backend.utilities.rate_limit import limiter

from .router import router


class UploadFeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
    ]


class UploadFeedbackResponse(BaseModel):
    id: int


@router.post("/me/upload-feedback", status_code=201)
@limiter.limit("3/hour")
async def submit_upload_feedback(
    request: Request,
    body: UploadFeedbackRequest,
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
    await schedule_upload_feedback_notification(feedback.id)
    return UploadFeedbackResponse(id=feedback.id)
