"""Track upload endpoints and background processing."""

import asyncio
import contextlib
import json
import logging
import tempfile
from pathlib import Path
from typing import Annotated

import logfire
from fastapi import BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from backend._internal import Session as AuthSession
from backend._internal import require_artist_profile
from backend._internal.atproto import create_track_record
from backend._internal.atproto.handles import resolve_handle
from backend._internal.audio import AudioFormat
from backend._internal.image import ImageFormat
from backend._internal.uploads import UploadStatus, upload_tracker
from backend.config import settings
from backend.models import Artist, Track
from backend.storage import storage
from backend.storage.r2 import R2Storage
from backend.utilities.database import db_session
from backend.utilities.hashing import CHUNK_SIZE

from .router import router
from .services import get_or_create_album

logger = logging.getLogger(__name__)


async def _process_upload_background(
    upload_id: str,
    file_path: str,
    filename: str,
    title: str,
    artist_did: str,
    album: str | None,
    features: str | None,
    auth_session: AuthSession,
    image_path: str | None = None,
    image_filename: str | None = None,
) -> None:
    """Background task to process upload."""
    with logfire.span(
        "process upload background", upload_id=upload_id, filename=filename
    ):
        try:
            upload_tracker.update_status(
                upload_id, UploadStatus.PROCESSING, "processing upload..."
            )

            # validate file type
            ext = Path(filename).suffix.lower()
            audio_format = AudioFormat.from_extension(ext)
            if not audio_format:
                upload_tracker.update_status(
                    upload_id,
                    UploadStatus.FAILED,
                    "upload failed",
                    error=f"unsupported file type: {ext}",
                )
                return

            # save audio file
            upload_tracker.update_status(
                upload_id,
                UploadStatus.PROCESSING,
                "saving audio file...",
                phase="upload",
            )
            try:
                logfire.info("preparing to save audio file", filename=filename)

                # define progress callback for storage upload
                def on_upload_progress(progress_pct: float) -> None:
                    """callback invoked during R2 upload with progress percentage."""
                    upload_tracker.update_status(
                        upload_id,
                        UploadStatus.PROCESSING,
                        f"uploading to storage... {int(progress_pct)}%",
                        server_progress_pct=progress_pct,
                        phase="upload",
                    )

                with open(file_path, "rb") as file_obj:
                    logfire.info("calling storage.save")
                    file_id = await storage.save(
                        file_obj, filename, progress_callback=on_upload_progress
                    )
                    logfire.info("storage.save completed", file_id=file_id)
            except ValueError as e:
                logfire.error("ValueError during storage.save", error=str(e))
                upload_tracker.update_status(
                    upload_id, UploadStatus.FAILED, "upload failed", error=str(e)
                )
                return
            except Exception as e:
                logfire.error(
                    "unexpected exception during storage.save",
                    error=str(e),
                    exc_info=True,
                )
                upload_tracker.update_status(
                    upload_id, UploadStatus.FAILED, "upload failed", error=str(e)
                )
                return

            # check for duplicate uploads (same file_id + artist_did)
            async with db_session() as db:
                stmt = select(Track).where(
                    Track.file_id == file_id,
                    Track.artist_did == artist_did,
                )
                result = await db.execute(stmt)
                existing_track = result.scalar_one_or_none()

                if existing_track:
                    logfire.info(
                        "duplicate upload detected, returning existing track",
                        file_id=file_id,
                        existing_track_id=existing_track.id,
                        artist_did=artist_did,
                    )
                    upload_tracker.update_status(
                        upload_id,
                        UploadStatus.FAILED,
                        "upload failed",
                        error=f"duplicate upload: track already exists (id: {existing_track.id})",
                    )
                    return

            # get R2 URL
            r2_url = None
            if settings.storage.backend == "r2":
                if isinstance(storage, R2Storage):
                    r2_url = await storage.get_url(file_id)

            # save image if provided
            image_id = None
            image_url = None
            if image_path and image_filename:
                upload_tracker.update_status(
                    upload_id,
                    UploadStatus.PROCESSING,
                    "saving image...",
                    phase="image",
                )
                image_format, is_valid = ImageFormat.validate_and_extract(
                    image_filename
                )
                if is_valid and image_format:
                    try:
                        with open(image_path, "rb") as image_obj:
                            # save with images/ prefix to namespace it
                            image_id = await storage.save(
                                image_obj, f"images/{image_filename}"
                            )
                            # get R2 URL for image if using R2 storage
                            if settings.storage.backend == "r2" and isinstance(
                                storage, R2Storage
                            ):
                                image_url = await storage.get_url(image_id)
                    except Exception as e:
                        logger.warning(f"failed to save image: {e}", exc_info=True)
                        # continue without image - it's optional
                else:
                    logger.warning(f"unsupported image format: {image_filename}")

            # get artist and resolve features
            async with db_session() as db:
                result = await db.execute(
                    select(Artist).where(Artist.did == artist_did)
                )
                artist = result.scalar_one_or_none()
                if not artist:
                    upload_tracker.update_status(
                        upload_id,
                        UploadStatus.FAILED,
                        "upload failed",
                        error="artist profile not found",
                    )
                    return

                # resolve featured artist handles
                featured_artists = []
                if features:
                    upload_tracker.update_status(
                        upload_id,
                        UploadStatus.PROCESSING,
                        "resolving featured artists...",
                        phase="metadata",
                    )
                    try:
                        handles_list = json.loads(features)
                        if isinstance(handles_list, list):
                            # filter valid handles and batch resolve concurrently
                            valid_handles = [
                                handle
                                for handle in handles_list
                                if isinstance(handle, str)
                                and handle.lstrip("@") != artist.handle
                            ]
                            if valid_handles:
                                resolved_artists = await asyncio.gather(
                                    *[resolve_handle(h) for h in valid_handles],
                                    return_exceptions=True,
                                )
                                # filter out exceptions and None values
                                featured_artists = [
                                    r
                                    for r in resolved_artists
                                    if isinstance(r, dict) and r is not None
                                ]
                    except json.JSONDecodeError:
                        pass  # ignore malformed features

                # create ATProto record
                atproto_uri = None
                atproto_cid = None
                if r2_url:
                    upload_tracker.update_status(
                        upload_id,
                        UploadStatus.PROCESSING,
                        "creating atproto record...",
                        phase="atproto",
                    )
                    try:
                        result = await create_track_record(
                            auth_session=auth_session,
                            title=title,
                            artist=artist.display_name,
                            audio_url=r2_url,
                            file_type=ext[1:],
                            album=album,
                            duration=None,
                            features=featured_artists if featured_artists else None,
                            image_url=image_url,
                        )
                        if result:
                            atproto_uri, atproto_cid = result
                    except Exception as e:
                        logger.warning(
                            f"failed to create ATProto record: {e}", exc_info=True
                        )

                # create track record
                upload_tracker.update_status(
                    upload_id,
                    UploadStatus.PROCESSING,
                    "saving track metadata...",
                    phase="database",
                )
                extra = {}
                album_record = None
                if album:
                    extra["album"] = album
                    album_record = await get_or_create_album(
                        db,
                        artist,
                        album,
                        image_id,
                        image_url,
                    )

                track = Track(
                    title=title,
                    file_id=file_id,
                    file_type=ext[1:],
                    artist_did=artist_did,
                    extra=extra,
                    album_id=album_record.id if album_record else None,
                    features=featured_artists,
                    r2_url=r2_url,
                    atproto_record_uri=atproto_uri,
                    atproto_record_cid=atproto_cid,
                    image_id=image_id,
                    image_url=image_url,
                )

                db.add(track)
                try:
                    await db.commit()
                    await db.refresh(track)

                    # send notification about new track
                    from backend._internal.notifications import notification_service

                    try:
                        # eagerly load artist for notification
                        await db.refresh(track, ["artist"])
                        await notification_service.send_track_notification(track)
                        track.notification_sent = True
                        await db.commit()
                    except Exception as e:
                        logger.warning(
                            f"failed to send notification for track {track.id}: {e}"
                        )

                    upload_tracker.update_status(
                        upload_id,
                        UploadStatus.COMPLETED,
                        "upload completed successfully",
                        track_id=track.id,
                    )

                except IntegrityError as e:
                    await db.rollback()
                    # integrity errors now only occur for foreign key violations or other constraints
                    error_msg = f"database constraint violation: {e!s}"
                    upload_tracker.update_status(
                        upload_id, UploadStatus.FAILED, "upload failed", error=error_msg
                    )
                    # cleanup: delete uploaded file
                    with contextlib.suppress(Exception):
                        await storage.delete(file_id, audio_format.value)

        except Exception as e:
            logger.exception(f"upload {upload_id} failed with unexpected error")
            upload_tracker.update_status(
                upload_id,
                UploadStatus.FAILED,
                "upload failed",
                error=f"unexpected error: {e!s}",
            )
        finally:
            # cleanup temp files
            with contextlib.suppress(Exception):
                Path(file_path).unlink(missing_ok=True)
            if image_path:
                with contextlib.suppress(Exception):
                    Path(image_path).unlink(missing_ok=True)


@router.post("/")
async def upload_track(
    title: Annotated[str, Form()],
    background_tasks: BackgroundTasks,
    auth_session: AuthSession = Depends(require_artist_profile),
    album: Annotated[str | None, Form()] = None,
    features: Annotated[str | None, Form()] = None,
    file: UploadFile = File(...),
    image: UploadFile | None = File(None),
) -> dict:
    """Upload a new track (requires authentication and artist profile).

    Parameters:
        title: Track title (required).
        album: Optional album name/ID to associate with the track.
        features: Optional JSON array of ATProto handles, e.g.,
            ["user1.bsky.social", "user2.bsky.social"].
        file: Audio file to upload (required).
        image: Optional image file for track artwork.
        background_tasks: FastAPI background-task runner.
        auth_session: Authenticated artist session (dependency-injected).

    Returns:
        dict: A payload containing `upload_id` for monitoring progress via SSE.
    """
    # validate audio file type upfront
    if not file.filename:
        raise HTTPException(status_code=400, detail="no filename provided")

    ext = Path(file.filename).suffix.lower()
    audio_format = AudioFormat.from_extension(ext)
    if not audio_format:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported file type: {ext}. "
            f"supported: {AudioFormat.supported_extensions_str()}",
        )

    # stream file to temp file (constant memory)
    file_path = None
    image_path = None
    try:
        # enforce max upload size
        max_size = settings.storage.max_upload_size_mb * 1024 * 1024
        bytes_read = 0

        with tempfile.NamedTemporaryFile(
            delete=False, suffix=Path(file.filename).suffix
        ) as tmp_file:
            file_path = tmp_file.name
            # stream upload file to temp file in chunks
            while chunk := await file.read(CHUNK_SIZE):
                bytes_read += len(chunk)
                if bytes_read > max_size:
                    # cleanup temp file before raising
                    tmp_file.close()
                    Path(file_path).unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"file too large (max {settings.storage.max_upload_size_mb}MB)",
                    )
                tmp_file.write(chunk)

        # stream image to temp file if provided
        image_filename = None
        if image and image.filename:
            image_filename = image.filename
            # images have much smaller limit (20MB is generous for cover art)
            max_image_size = 20 * 1024 * 1024
            image_bytes_read = 0

            with tempfile.NamedTemporaryFile(
                delete=False, suffix=Path(image.filename).suffix
            ) as tmp_image:
                image_path = tmp_image.name
                # stream image file to temp file in chunks
                while chunk := await image.read(CHUNK_SIZE):
                    image_bytes_read += len(chunk)
                    if image_bytes_read > max_image_size:
                        # cleanup temp files before raising
                        tmp_image.close()
                        Path(image_path).unlink(missing_ok=True)
                        if file_path:
                            Path(file_path).unlink(missing_ok=True)
                        raise HTTPException(
                            status_code=413,
                            detail="image too large (max 20MB)",
                        )
                    tmp_image.write(chunk)

        # create upload tracking
        upload_id = upload_tracker.create_upload()

        # schedule background processing once response is sent
        background_tasks.add_task(
            _process_upload_background,
            upload_id,
            file_path,
            file.filename,
            title,
            auth_session.did,
            album,
            features,
            auth_session,
            image_path,
            image_filename,
        )
    except Exception:
        if file_path:
            with contextlib.suppress(Exception):
                Path(file_path).unlink(missing_ok=True)
        if image_path:
            with contextlib.suppress(Exception):
                Path(image_path).unlink(missing_ok=True)
        raise

    return {
        "upload_id": upload_id,
        "status": "pending",
        "message": "upload queued for processing",
    }


@router.get("/uploads/{upload_id}/progress")
async def upload_progress(upload_id: str) -> StreamingResponse:
    """SSE endpoint for real-time upload progress."""

    async def event_stream():
        """Generate SSE events for upload progress."""
        queue = await upload_tracker.subscribe(upload_id)
        try:
            while True:
                try:
                    # wait for next update with timeout
                    update = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(update)}\n\n"

                    # if upload completed or failed, close stream
                    if update["status"] in ("completed", "failed"):
                        break

                except TimeoutError:
                    # send keepalive
                    yield ": keepalive\n\n"

        finally:
            upload_tracker.unsubscribe(upload_id, queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )
