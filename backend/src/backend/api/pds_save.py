"""API endpoints for saving audio to a user's PDS."""

import asyncio
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.jobs import job_service
from backend._internal.pds_save_tasks import schedule_pds_save
from backend.models import Track, get_db
from backend.models.job import JobStatus, JobType

router = APIRouter(prefix="/pds-save", tags=["pds"])
logger = logging.getLogger(__name__)


class PdsSaveStartRequest(BaseModel):
    """optional request body for selectively saving tracks."""

    track_ids: list[int] | None = None  # if None, save all eligible


class PdsSaveStartResponse(BaseModel):
    """response when a PDS save is queued for processing."""

    save_id: str
    status: str
    message: str
    track_count: int


@router.post("/audio")
async def save_audio_to_pds(
    session: Annotated[Session, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    body: PdsSaveStartRequest | None = None,
) -> PdsSaveStartResponse:
    """start saving existing tracks' audio to the user's PDS.

    optionally accepts a list of track_ids to selectively save.
    returns a save_id for tracking progress via SSE.
    """
    stmt = (
        select(Track.id)
        .where(
            Track.artist_did == session.did,
            Track.support_gate.is_(None),
            Track.pds_blob_cid.is_(None),
            Track.file_id.isnot(None),
        )
        .order_by(Track.created_at.desc())
    )
    if body and body.track_ids:
        stmt = stmt.where(Track.id.in_(body.track_ids))
    result = await db.execute(stmt)
    track_ids = [row[0] for row in result.all()]

    if not track_ids:
        raise HTTPException(status_code=404, detail="no tracks found to save")

    save_id = await job_service.create_job(
        JobType.PDS_SAVE,
        session.did,
        "save queued for processing",
    )

    await schedule_pds_save(save_id, session.session_id, track_ids)

    return PdsSaveStartResponse(
        save_id=save_id,
        status="pending",
        message="save queued for processing",
        track_count=len(track_ids),
    )


@router.get("/{save_id}/progress")
async def save_progress(save_id: str) -> StreamingResponse:
    """SSE endpoint for PDS save progress."""

    async def event_stream():
        try:
            while True:
                job = await job_service.get_job(save_id)
                if not job:
                    yield (
                        "data: "
                        + json.dumps(
                            {
                                "status": "failed",
                                "message": "save job not found",
                                "error": "job lost",
                            }
                        )
                        + "\n\n"
                    )
                    break

                payload = {
                    "save_id": job.id,
                    "status": job.status,
                    "message": job.message,
                    "error": job.error,
                    "processed_count": job.result.get("processed_count")
                    if job.result
                    else 0,
                    "total_count": job.result.get("total_count") if job.result else 0,
                    "saved_count": job.result.get("saved_count") if job.result else 0,
                    "skipped_count": job.result.get("skipped_count")
                    if job.result
                    else 0,
                    "failed_count": job.result.get("failed_count") if job.result else 0,
                    "last_processed_track_id": job.result.get("last_processed_track_id")
                    if job.result
                    else None,
                    "last_status": job.result.get("last_status")
                    if job.result
                    else None,
                }

                yield f"data: {json.dumps(payload)}\n\n"

                if job.status in (JobStatus.COMPLETED.value, JobStatus.FAILED.value):
                    break

                await asyncio.sleep(1.0)

        except Exception as e:
            logger.error(f"error in pds save progress stream: {e}")
            yield (
                "data: "
                + json.dumps(
                    {
                        "status": "failed",
                        "message": "connection error",
                        "error": str(e),
                    }
                )
                + "\n\n"
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
