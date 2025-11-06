"""queue api endpoints."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, queue_service, require_auth
from backend.models import UserPreferences, get_db

router = APIRouter(prefix="/queue", tags=["queue"])


class QueueResponse(BaseModel):
    """queue state response model."""

    state: dict[str, Any]
    revision: int
    tracks: list[dict[str, Any]] = Field(default_factory=list)


class QueueUpdate(BaseModel):
    """queue state update model."""

    state: dict[str, Any]


@router.get("/")
async def get_queue(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> QueueResponse:
    """get current queue state with ETag for caching."""
    result = await queue_service.get_queue(session.did)

    if result is None:
        # return empty queue with auto_advance from preferences
        prefs_result = await db.execute(
            select(UserPreferences).where(UserPreferences.did == session.did)
        )
        prefs = prefs_result.scalar_one_or_none()
        auto_advance = prefs.auto_advance if prefs else True

        state = {
            "track_ids": [],
            "current_index": 0,
            "current_track_id": None,
            "shuffle": False,
            "original_order_ids": [],
            "auto_advance": auto_advance,
        }
        revision = 0
        response.headers["ETag"] = f'"{revision}"'
        return QueueResponse(state=state, revision=revision, tracks=[])

    state, revision, tracks = result
    # set ETag header for client caching
    response.headers["ETag"] = f'"{revision}"'

    return QueueResponse(state=state, revision=revision, tracks=tracks)


@router.put("/")
async def update_queue(
    update: QueueUpdate,
    session: Session = Depends(require_auth),
    if_match: Annotated[str | None, Header()] = None,
) -> QueueResponse:
    """update queue state with optimistic locking via If-Match header.

    the If-Match header should contain the expected revision number (as ETag).
    if there's a conflict (revision mismatch), returns 409.
    """
    # parse expected revision from If-Match header
    expected_revision: int | None = None
    if if_match:
        # strip quotes from ETag format: "123" -> 123
        try:
            expected_revision = int(if_match.strip('"'))
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="invalid If-Match header format (expected quoted integer)",
            ) from None

    # update with conflict detection
    result = await queue_service.update_queue(
        did=session.did,
        state=update.state,
        expected_revision=expected_revision,
    )

    if result is None:
        # conflict detected
        raise HTTPException(
            status_code=409,
            detail="queue state conflict: state has been modified by another client. "
            "please fetch the latest state and retry.",
        )

    state, revision, tracks = result
    return QueueResponse(state=state, revision=revision, tracks=tracks)
