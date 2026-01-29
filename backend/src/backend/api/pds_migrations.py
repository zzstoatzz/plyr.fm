"""API endpoints for PDS audio migrations."""

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
from backend._internal.pds_migration_tasks import schedule_pds_migration
from backend.models import Track, get_db
from backend.models.job import JobStatus, JobType

router = APIRouter(prefix="/pds-migrations", tags=["pds"])
logger = logging.getLogger(__name__)


class PdsMigrationStartResponse(BaseModel):
    """response when PDS migration is queued for processing."""

    migration_id: str
    status: str
    message: str
    track_count: int


@router.post("/audio")
async def migrate_audio_to_pds(
    session: Annotated[Session, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> PdsMigrationStartResponse:
    """start migration of existing tracks to the user's PDS.

    returns a migration_id for tracking progress via SSE.
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
    result = await db.execute(stmt)
    track_ids = [row[0] for row in result.all()]

    if not track_ids:
        raise HTTPException(status_code=404, detail="no tracks found to migrate")

    migration_id = await job_service.create_job(
        JobType.PDS_MIGRATION,
        session.did,
        "migration queued for processing",
    )

    await schedule_pds_migration(migration_id, session.session_id, track_ids)

    return PdsMigrationStartResponse(
        migration_id=migration_id,
        status="pending",
        message="migration queued for processing",
        track_count=len(track_ids),
    )


@router.get("/{migration_id}/progress")
async def migration_progress(migration_id: str) -> StreamingResponse:
    """SSE endpoint for PDS migration progress."""

    async def event_stream():
        try:
            while True:
                job = await job_service.get_job(migration_id)
                if not job:
                    yield (
                        "data: "
                        + json.dumps(
                            {
                                "status": "failed",
                                "message": "migration job not found",
                                "error": "job lost",
                            }
                        )
                        + "\n\n"
                    )
                    break

                payload = {
                    "migration_id": job.id,
                    "status": job.status,
                    "message": job.message,
                    "error": job.error,
                    "processed_count": job.result.get("processed_count")
                    if job.result
                    else 0,
                    "total_count": job.result.get("total_count") if job.result else 0,
                    "migrated_count": job.result.get("migrated_count")
                    if job.result
                    else 0,
                    "skipped_count": job.result.get("skipped_count")
                    if job.result
                    else 0,
                    "failed_count": job.result.get("failed_count") if job.result else 0,
                }

                yield f"data: {json.dumps(payload)}\n\n"

                if job.status in (JobStatus.COMPLETED.value, JobStatus.FAILED.value):
                    break

                await asyncio.sleep(1.0)

        except Exception as e:
            logger.error(f"error in migration progress stream: {e}")
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
