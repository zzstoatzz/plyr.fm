"""media export API endpoints."""

import asyncio
import io
import json
import logging
import zipfile
from typing import Annotated

import aioboto3
import logfire
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import RedirectResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.jobs import job_service
from backend.config import settings
from backend.models import Track, get_db
from backend.models.job import JobStatus, JobType
from backend.utilities.database import db_session
from backend.utilities.progress import R2ProgressTracker

router = APIRouter(prefix="/exports", tags=["exports"])
logger = logging.getLogger(__name__)


async def _process_export_background(export_id: str, artist_did: str) -> None:
    """background task to process export."""
    try:
        await job_service.update_progress(
            export_id, JobStatus.PROCESSING, "fetching tracks..."
        )

        # query all tracks for the user
        async with db_session() as db:
            stmt = (
                select(Track)
                .where(Track.artist_did == artist_did)
                .order_by(Track.created_at)
            )
            result = await db.execute(stmt)
            tracks = result.scalars().all()

        if not tracks:
            await job_service.update_progress(
                export_id,
                JobStatus.FAILED,
                "export failed",
                error="no tracks found to export",
            )
            return

        # create zip archive in memory
        zip_buffer = io.BytesIO()
        async_session = aioboto3.Session()

        async with async_session.client(
            "s3",
            endpoint_url=settings.storage.r2_endpoint_url,
            aws_access_key_id=settings.storage.aws_access_key_id,
            aws_secret_access_key=settings.storage.aws_secret_access_key,
        ) as s3_client:
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
                # track counter for duplicate titles
                title_counts: dict[str, int] = {}
                processed = 0
                total = len(tracks)

                for track in tracks:
                    if not track.file_id or not track.file_type:
                        logfire.warn(
                            "skipping track: missing file_id or file_type",
                            track_id=track.id,
                        )
                        continue

                    # construct R2 key
                    key = f"audio/{track.file_id}.{track.file_type}"

                    try:
                        # update progress
                        pct = (processed / total) * 100
                        await job_service.update_progress(
                            export_id,
                            JobStatus.PROCESSING,
                            f"downloading {track.title}...",
                            progress_pct=pct,
                            result={"processed_count": processed, "total_count": total},
                        )

                        # download file from R2
                        response = await s3_client.get_object(
                            Bucket=settings.storage.r2_bucket,
                            Key=key,
                        )

                        # read file content
                        file_content = await response["Body"].read()

                        # create safe filename
                        # handle duplicate titles by appending counter
                        base_filename = f"{track.title}.{track.file_type}"
                        if base_filename in title_counts:
                            title_counts[base_filename] += 1
                            filename = f"{track.title} ({title_counts[base_filename]}).{track.file_type}"
                        else:
                            title_counts[base_filename] = 0
                            filename = base_filename

                        # sanitize filename (remove invalid chars)
                        filename = "".join(
                            c
                            for c in filename
                            if c.isalnum() or c in (" ", ".", "-", "_", "(", ")")
                        )

                        # add to zip
                        zip_file.writestr(filename, file_content)

                        processed += 1
                        logfire.info(
                            "added track to export: {track_title}",
                            track_id=track.id,
                            track_title=track.title,
                            filename=filename,
                        )

                    except Exception as e:
                        logfire.error(
                            "failed to add track to export: {track_title}",
                            track_id=track.id,
                            track_title=track.title,
                            error=str(e),
                            _exc_info=True,
                        )
                        # continue with other tracks instead of failing entire export

        # store the zip data to R2
        zip_buffer.seek(0)
        zip_filename = f"{export_id}.zip"
        key = f"exports/{zip_filename}"

        # Upload using aioboto3 directly
        try:
            async_session = aioboto3.Session()
            zip_size = zip_buffer.getbuffer().nbytes

            # Generate user-friendly filename for download
            from datetime import datetime

            download_filename = f"plyr-tracks-{datetime.now().date()}.zip"

            async with (
                R2ProgressTracker(
                    job_id=export_id,
                    total_size=zip_size,
                    message="finalizing export...",
                    phase="upload",
                ) as tracker,
                async_session.client(
                    "s3",
                    endpoint_url=settings.storage.r2_endpoint_url,
                    aws_access_key_id=settings.storage.aws_access_key_id,
                    aws_secret_access_key=settings.storage.aws_secret_access_key,
                ) as s3_client,
            ):
                await s3_client.upload_fileobj(
                    zip_buffer,
                    settings.storage.r2_bucket,
                    key,
                    ExtraArgs={
                        "ContentType": "application/zip",
                        "ContentDisposition": f'attachment; filename="{download_filename}"',
                    },
                    Callback=tracker.on_progress,
                )

            # Final 100% update
            await job_service.update_progress(
                export_id,
                JobStatus.PROCESSING,
                "finalizing export...",
                phase="upload",
                progress_pct=100.0,
            )

        except Exception as e:
            logfire.error("failed to upload export zip", error=str(e))
            raise

        # get download URL
        download_url = f"{settings.storage.r2_public_bucket_url}/{key}"

        # mark as completed
        await job_service.update_progress(
            export_id,
            JobStatus.COMPLETED,
            f"export completed - {processed} tracks ready",
            result={
                "processed_count": processed,
                "total_count": len(tracks),
                "download_url": download_url,
            },
        )

    except Exception as e:
        logfire.exception(
            "export failed with unexpected error",
            export_id=export_id,
        )
        await job_service.update_progress(
            export_id,
            JobStatus.FAILED,
            "export failed",
            error=f"unexpected error: {e!s}",
        )


@router.post("/media")
async def export_media(
    session: Annotated[Session, Depends(require_auth)],
    db: Annotated[AsyncSession, Depends(get_db)],
    background_tasks: BackgroundTasks,
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

    # schedule background processing
    background_tasks.add_task(_process_export_background, export_id, session.did)

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
