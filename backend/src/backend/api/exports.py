"""media export API endpoints."""

import asyncio
import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.background_tasks import schedule_export
from backend._internal.jobs import job_service
from backend.models import Track, get_db
from backend.models.job import JobStatus, JobType

router = APIRouter(prefix="/exports", tags=["exports"])
logger = logging.getLogger(__name__)


@router.post("/media")
async def export_media(
    session: Annotated[Session, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """start export of all tracks for authenticated user.

    returns an export_id for tracking progress via SSE.
    """
    # count tracks first
    stmt = select(Track).where(Track.artist_did == session.did)
    result = await db.execute(stmt)
    tracks = result.scalars().all()

    if not tracks:
        raise HTTPException(status_code=404, detail="no tracks found to export")

    # create export tracking
    export_id = await job_service.create_job(
        JobType.EXPORT, session.did, "export queued for processing"
    )

    # schedule background processing via docket (or asyncio fallback)
    await schedule_export(export_id, session.did)

    return {
        "export_id": export_id,
        "status": "pending",
        "message": "export queued for processing",
        "track_count": len(tracks),
    }


@router.get("/{export_id}/progress")
async def export_progress(export_id: str) -> StreamingResponse:
    """SSE endpoint for real-time export progress."""

    async def event_stream():
        """generate SSE events for export progress."""
        # Polling loop
        try:
            while True:
                job = await job_service.get_job(export_id)
                if not job:
                    yield f"data: {json.dumps({'status': 'failed', 'message': 'export job not found', 'error': 'job lost'})}\n\n"
                    break

                # Construct payload
                payload = {
                    "export_id": job.id,
                    "status": job.status,
                    "message": job.message,
                    "error": job.error,
                    "processed_count": job.result.get("processed_count")
                    if job.result
                    else 0,
                    "total_count": job.result.get("total_count") if job.result else 0,
                }
                if job.result and "download_url" in job.result:
                    payload["download_url"] = job.result["download_url"]

                yield f"data: {json.dumps(payload)}\n\n"

                if job.status in (JobStatus.COMPLETED.value, JobStatus.FAILED.value):
                    break

                await asyncio.sleep(1.0)

        except Exception as e:
            logger.error(f"error in export progress stream: {e}")
            yield f"data: {json.dumps({'status': 'failed', 'message': 'connection error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


@router.get("/{export_id}/download")
async def download_export(
    export_id: str,
    session: Annotated[Session, Depends(require_auth)],
) -> RedirectResponse:
    """download the completed export zip file."""
    job = await job_service.get_job(export_id)

    if not job:
        raise HTTPException(status_code=404, detail="export not found")

    if job.owner_did != session.did:
        raise HTTPException(status_code=403, detail="not authorized")

    if job.status != JobStatus.COMPLETED.value:
        raise HTTPException(status_code=400, detail="export not ready")

    if not job.result or "download_url" not in job.result:
        raise HTTPException(status_code=500, detail="export url not found")

    return RedirectResponse(url=job.result["download_url"])
