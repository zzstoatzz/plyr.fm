"""media export API endpoints."""

import asyncio
import io
import json
import zipfile
from typing import Annotated

import aioboto3
import logfire
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.exports import ExportStatus, export_tracker
from backend.config import settings
from backend.models import Track, get_db
from backend.utilities.database import db_session

router = APIRouter(prefix="/exports", tags=["exports"])


async def _process_export_background(export_id: str, artist_did: str) -> None:
    """background task to process export."""
    try:
        export_tracker.update_status(
            export_id, ExportStatus.PROCESSING, "fetching tracks..."
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
            export_tracker.update_status(
                export_id,
                ExportStatus.FAILED,
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
                        export_tracker.update_status(
                            export_id,
                            ExportStatus.PROCESSING,
                            f"downloading {track.title}...",
                            processed_count=processed,
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
                            "added track to export",
                            track_id=track.id,
                            filename=filename,
                        )

                    except Exception as e:
                        logfire.error(
                            "failed to add track to export",
                            track_id=track.id,
                            error=str(e),
                            _exc_info=True,
                        )
                        # continue with other tracks instead of failing entire export

        # store the zip data
        zip_buffer.seek(0)
        export_tracker.store_export_data(export_id, zip_buffer.getvalue())

        # mark as completed
        export_tracker.update_status(
            export_id,
            ExportStatus.COMPLETED,
            f"export completed - {processed} tracks ready",
            processed_count=processed,
        )

    except Exception as e:
        logfire.exception(
            "export failed with unexpected error",
            export_id=export_id,
        )
        export_tracker.update_status(
            export_id,
            ExportStatus.FAILED,
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
    export_id = export_tracker.create_export(track_count=len(tracks))

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
        queue = await export_tracker.subscribe(export_id)
        try:
            while True:
                try:
                    # wait for next update with timeout
                    update = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(update)}\n\n"

                    # if export completed or failed, close stream
                    if update["status"] in ("completed", "failed"):
                        break

                except TimeoutError:
                    # send keepalive
                    yield ": keepalive\n\n"

        finally:
            export_tracker.unsubscribe(export_id, queue)

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
) -> StreamingResponse:
    """download the completed export zip file."""
    export_data = export_tracker.get_export_data(export_id)

    if not export_data:
        raise HTTPException(status_code=404, detail="export not found or expired")

    return StreamingResponse(
        iter([export_data]),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="plyr-tracks.zip"',
        },
    )
