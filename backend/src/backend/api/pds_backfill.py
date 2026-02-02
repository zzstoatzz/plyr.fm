"""API endpoints for PDS audio backfill."""

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
from backend._internal.feature_flags import has_flag
from backend._internal.jobs import job_service
from backend._internal.pds_backfill_tasks import schedule_pds_backfill
from backend.models import Track, get_db
from backend.models.job import JobStatus, JobType

PDS_AUDIO_UPLOADS_FLAG = "pds-audio-uploads"

router = APIRouter(prefix="/pds-backfill", tags=["pds"])
logger = logging.getLogger(__name__)


class PdsBackfillStartRequest(BaseModel):
    """optional request body for selective backfill."""

    track_ids: list[int] | None = None  # if None, backfill all eligible


class PdsBackfillStartResponse(BaseModel):
    """response when PDS backfill is queued for processing."""

    backfill_id: str
    status: str
    message: str
    track_count: int


@router.post("/audio")
async def backfill_audio_to_pds(
    session: Annotated[Session, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    body: PdsBackfillStartRequest | None = None,
) -> PdsBackfillStartResponse:
    """start backfill of existing tracks to the user's PDS.

    requires the pds-audio-uploads feature flag.
    optionally accepts a list of track_ids to selectively backfill.
    returns a backfill_id for tracking progress via SSE.
    """
    if not await has_flag(db, session.did, PDS_AUDIO_UPLOADS_FLAG):
        raise HTTPException(status_code=403, detail="pds audio uploads not enabled")

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
        raise HTTPException(status_code=404, detail="no tracks found to backfill")

    backfill_id = await job_service.create_job(
        JobType.PDS_BACKFILL,
        session.did,
        "backfill queued for processing",
    )

    await schedule_pds_backfill(backfill_id, session.session_id, track_ids)

    return PdsBackfillStartResponse(
        backfill_id=backfill_id,
        status="pending",
        message="backfill queued for processing",
        track_count=len(track_ids),
    )


@router.get("/{backfill_id}/progress")
async def backfill_progress(backfill_id: str) -> StreamingResponse:
    """SSE endpoint for PDS backfill progress."""

    async def event_stream():
        try:
            while True:
                job = await job_service.get_job(backfill_id)
                if not job:
                    yield (
                        "data: "
                        + json.dumps(
                            {
                                "status": "failed",
                                "message": "backfill job not found",
                                "error": "job lost",
                            }
                        )
                        + "\n\n"
                    )
                    break

                payload = {
                    "backfill_id": job.id,
                    "status": job.status,
                    "message": job.message,
                    "error": job.error,
                    "processed_count": job.result.get("processed_count")
                    if job.result
                    else 0,
                    "total_count": job.result.get("total_count") if job.result else 0,
                    "backfilled_count": job.result.get("backfilled_count")
                    if job.result
                    else 0,
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
            logger.error(f"error in backfill progress stream: {e}")
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
