"""Track upload endpoints and background processing."""

import asyncio
import contextlib
import json
import logging
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

import logfire
from fastapi import (
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session as AuthSession
from backend._internal import require_artist_profile
from backend._internal.atproto import create_track_record
from backend._internal.atproto.handles import resolve_featured_artists
from backend._internal.audio import AudioFormat
from backend._internal.background_tasks import (
    schedule_album_list_sync,
    schedule_copyright_scan,
)
from backend._internal.image import ImageFormat
from backend._internal.jobs import job_service
from backend.config import settings
from backend.models import Artist, Tag, Track, TrackTag, UserPreferences
from backend.models.job import JobStatus, JobType
from backend.storage import storage
from backend.utilities.audio import extract_duration
from backend.utilities.database import db_session
from backend.utilities.hashing import CHUNK_SIZE
from backend.utilities.progress import R2ProgressTracker
from backend.utilities.rate_limit import limiter
from backend.utilities.tags import parse_tags_json

from .router import router
from .services import get_or_create_album

logger = logging.getLogger(__name__)


@dataclass
class UploadContext:
    """all data needed to process an upload in the background."""

    upload_id: str
    auth_session: AuthSession

    # audio file
    file_path: str
    filename: str

    # track metadata
    title: str
    artist_did: str
    album: str | None
    features_json: str | None
    tags: list[str]

    # optional image
    image_path: str | None = None
    image_filename: str | None = None
    image_content_type: str | None = None

    # supporter-gated content (e.g., {"type": "any"})
    support_gate: dict | None = None


async def _get_or_create_tag(
    db: "AsyncSession", tag_name: str, creator_did: str
) -> Tag:
    """get existing tag or create new one, handling race conditions.

    uses a select-then-insert pattern with IntegrityError handling
    to safely handle concurrent tag creation.
    """
    # first try to find existing tag
    result = await db.execute(select(Tag).where(Tag.name == tag_name))
    tag = result.scalar_one_or_none()
    if tag:
        return tag

    # try to create new tag
    tag = Tag(
        name=tag_name,
        created_by_did=creator_did,
        created_at=datetime.now(UTC),
    )
    db.add(tag)

    try:
        await db.flush()
        return tag
    except IntegrityError as e:
        # only handle unique constraint violation on tag name (pgcode 23505)
        # re-raise other integrity errors (e.g., foreign key violations)
        pgcode = getattr(e.orig, "pgcode", None)
        if pgcode != "23505":
            raise
        # another process created the tag - rollback and fetch it
        await db.rollback()
        result = await db.execute(select(Tag).where(Tag.name == tag_name))
        tag = result.scalar_one()
        return tag


async def _save_audio_to_storage(
    upload_id: str,
    file_path: str,
    filename: str,
    *,
    gated: bool = False,
) -> str | None:
    """save audio file to storage, returning file_id or None on failure.

    args:
        upload_id: job tracking ID
        file_path: path to temp file
        filename: original filename
        gated: if True, save to private bucket (no public URL)
    """
    message = "uploading to private storage..." if gated else "uploading to storage..."
    await job_service.update_progress(
        upload_id,
        JobStatus.PROCESSING,
        message,
        phase="upload",
        progress_pct=0.0,
    )
    try:
        async with R2ProgressTracker(
            job_id=upload_id,
            message=message,
            phase="upload",
        ) as tracker:
            with open(file_path, "rb") as file_obj:
                if gated:
                    file_id = await storage.save_gated(
                        file_obj, filename, progress_callback=tracker.on_progress
                    )
                else:
                    file_id = await storage.save(
                        file_obj, filename, progress_callback=tracker.on_progress
                    )

        await job_service.update_progress(
            upload_id,
            JobStatus.PROCESSING,
            message,
            phase="upload",
            progress_pct=100.0,
        )
        logfire.info("storage.save completed", file_id=file_id, gated=gated)
        return file_id

    except Exception as e:
        logfire.error("storage.save failed", error=str(e), exc_info=True)
        await job_service.update_progress(
            upload_id, JobStatus.FAILED, "upload failed", error=str(e)
        )
        return None


async def _save_image_to_storage(
    upload_id: str,
    image_path: str,
    image_filename: str,
    image_content_type: str | None,
) -> tuple[str | None, str | None]:
    """save image to storage, returning (image_id, image_url) or (None, None)."""
    await job_service.update_progress(
        upload_id,
        JobStatus.PROCESSING,
        "saving image...",
        phase="image",
    )
    image_format, is_valid = ImageFormat.validate_and_extract(
        image_filename, image_content_type
    )
    if not is_valid or not image_format:
        logger.warning(f"unsupported image format: {image_filename}")
        return None, None

    try:
        with open(image_path, "rb") as image_obj:
            image_id = await storage.save(image_obj, f"images/{image_filename}")
            image_url = await storage.get_url(image_id, file_type="image")
            return image_id, image_url
    except Exception as e:
        logger.warning(f"failed to save image: {e}", exc_info=True)
        return None, None


async def _add_tags_to_track(
    db: AsyncSession,
    track_id: int,
    validated_tags: list[str],
    creator_did: str,
) -> None:
    """add validated tags to a track."""
    if not validated_tags:
        return

    try:
        for tag_name in validated_tags:
            tag = await _get_or_create_tag(db, tag_name, creator_did)
            track_tag = TrackTag(track_id=track_id, tag_id=tag.id)
            db.add(track_tag)
        await db.commit()
    except Exception as e:
        logfire.error(
            "failed to add tags to track",
            track_id=track_id,
            tags=validated_tags,
            error=str(e),
        )


async def _send_track_notification(db: AsyncSession, track: Track) -> None:
    """send notification for new track upload."""
    from backend._internal.notifications import notification_service

    try:
        await db.refresh(track, ["artist"])
        await notification_service.send_track_notification(track)
        track.notification_sent = True
        await db.commit()
    except Exception as e:
        logger.warning(f"failed to send notification for track {track.id}: {e}")


async def _process_upload_background(ctx: UploadContext) -> None:
    """background task to process upload."""
    with logfire.span(
        "process upload background", upload_id=ctx.upload_id, filename=ctx.filename
    ):
        file_id: str | None = None
        image_id: str | None = None
        audio_format: AudioFormat | None = None

        try:
            await job_service.update_progress(
                ctx.upload_id, JobStatus.PROCESSING, "processing upload..."
            )

            # validate file type
            ext = Path(ctx.filename).suffix.lower()
            audio_format = AudioFormat.from_extension(ext)
            if not audio_format:
                await job_service.update_progress(
                    ctx.upload_id,
                    JobStatus.FAILED,
                    "upload failed",
                    error=f"unsupported file type: {ext}",
                )
                return

            # extract duration
            with open(ctx.file_path, "rb") as f:
                duration = extract_duration(f)

            # validate gating requirements if support_gate is set
            is_gated = ctx.support_gate is not None
            if is_gated:
                async with db_session() as db:
                    prefs_result = await db.execute(
                        select(UserPreferences).where(
                            UserPreferences.did == ctx.artist_did
                        )
                    )
                    prefs = prefs_result.scalar_one_or_none()
                    if not prefs or prefs.support_url != "atprotofans":
                        await job_service.update_progress(
                            ctx.upload_id,
                            JobStatus.FAILED,
                            "upload failed",
                            error="supporter gating requires atprotofans to be enabled in settings",
                        )
                        return

            # save audio to storage (private bucket if gated)
            file_id = await _save_audio_to_storage(
                ctx.upload_id, ctx.file_path, ctx.filename, gated=is_gated
            )
            if not file_id:
                return

            # check for duplicate
            async with db_session() as db:
                result = await db.execute(
                    select(Track).where(
                        Track.file_id == file_id,
                        Track.artist_did == ctx.artist_did,
                    )
                )
                if existing := result.scalar_one_or_none():
                    await job_service.update_progress(
                        ctx.upload_id,
                        JobStatus.FAILED,
                        "upload failed",
                        error=f"duplicate upload: track already exists (id: {existing.id})",
                    )
                    return

            # get R2 URL (only for public tracks - gated tracks have no public URL)
            r2_url: str | None = None
            if not is_gated:
                r2_url = await storage.get_url(
                    file_id, file_type="audio", extension=ext[1:]
                )
                if not r2_url:
                    await job_service.update_progress(
                        ctx.upload_id,
                        JobStatus.FAILED,
                        "upload failed",
                        error="failed to get public audio URL",
                    )
                    return

            # save image if provided
            image_url = None
            if ctx.image_path and ctx.image_filename:
                image_id, image_url = await _save_image_to_storage(
                    ctx.upload_id,
                    ctx.image_path,
                    ctx.image_filename,
                    ctx.image_content_type,
                )

            # get artist and resolve featured artists
            async with db_session() as db:
                result = await db.execute(
                    select(Artist).where(Artist.did == ctx.artist_did)
                )
                artist = result.scalar_one_or_none()
                if not artist:
                    await job_service.update_progress(
                        ctx.upload_id,
                        JobStatus.FAILED,
                        "upload failed",
                        error="artist profile not found",
                    )
                    return

                # resolve featured artists
                featured_artists: list[dict] = []
                if ctx.features_json:
                    await job_service.update_progress(
                        ctx.upload_id,
                        JobStatus.PROCESSING,
                        "resolving featured artists...",
                        phase="metadata",
                    )
                    featured_artists = await resolve_featured_artists(
                        ctx.features_json, artist.handle
                    )

                # create ATProto record
                await job_service.update_progress(
                    ctx.upload_id,
                    JobStatus.PROCESSING,
                    "creating atproto record...",
                    phase="atproto",
                )
                try:
                    # for gated tracks, use API endpoint URL instead of direct R2 URL
                    # this ensures playback goes through our auth check
                    if is_gated:
                        # use backend URL for gated audio
                        from urllib.parse import urljoin

                        backend_url = settings.atproto.redirect_uri.rsplit("/", 2)[0]
                        audio_url_for_record = urljoin(
                            backend_url + "/", f"audio/{file_id}"
                        )
                    else:
                        # r2_url is guaranteed non-None here - we returned early above if None
                        assert r2_url is not None
                        audio_url_for_record = r2_url

                    atproto_result = await create_track_record(
                        auth_session=ctx.auth_session,
                        title=ctx.title,
                        artist=artist.display_name,
                        audio_url=audio_url_for_record,
                        file_type=ext[1:],
                        album=ctx.album,
                        duration=duration,
                        features=featured_artists or None,
                        image_url=image_url,
                        support_gate=ctx.support_gate,
                    )
                    if not atproto_result:
                        raise ValueError("PDS returned no record data")
                    atproto_uri, atproto_cid = atproto_result
                except Exception as e:
                    logger.error(
                        "ATProto sync failed for upload %s: %s", ctx.upload_id, e
                    )
                    await job_service.update_progress(
                        ctx.upload_id,
                        JobStatus.FAILED,
                        "upload failed",
                        error=f"failed to sync track to ATProto: {e}",
                        phase="atproto",
                    )
                    # cleanup orphaned media
                    with contextlib.suppress(Exception):
                        await storage.delete(file_id, audio_format.value)
                    if image_id:
                        with contextlib.suppress(Exception):
                            await storage.delete(image_id)
                    return

                # create track record
                await job_service.update_progress(
                    ctx.upload_id,
                    JobStatus.PROCESSING,
                    "saving track metadata...",
                    phase="database",
                )

                extra: dict = {}
                if duration:
                    extra["duration"] = duration

                album_record = None
                if ctx.album:
                    extra["album"] = ctx.album
                    album_record = await get_or_create_album(
                        db, artist, ctx.album, image_id, image_url
                    )

                track = Track(
                    title=ctx.title,
                    file_id=file_id,
                    file_type=ext[1:],
                    artist_did=ctx.artist_did,
                    extra=extra,
                    album_id=album_record.id if album_record else None,
                    features=featured_artists,
                    r2_url=r2_url,
                    atproto_record_uri=atproto_uri,
                    atproto_record_cid=atproto_cid,
                    image_id=image_id,
                    image_url=image_url,
                    support_gate=ctx.support_gate,
                )

                db.add(track)
                try:
                    await db.commit()
                    await db.refresh(track)

                    await _add_tags_to_track(db, track.id, ctx.tags, ctx.artist_did)
                    await _send_track_notification(db, track)

                    if r2_url:
                        await schedule_copyright_scan(track.id, r2_url)

                    # sync album list record if track is in an album
                    if album_record:
                        await schedule_album_list_sync(
                            ctx.auth_session.session_id, album_record.id
                        )

                    await job_service.update_progress(
                        ctx.upload_id,
                        JobStatus.COMPLETED,
                        "upload completed successfully",
                        result={"track_id": track.id},
                    )

                except IntegrityError as e:
                    await db.rollback()
                    await job_service.update_progress(
                        ctx.upload_id,
                        JobStatus.FAILED,
                        "upload failed",
                        error=f"database constraint violation: {e!s}",
                    )
                    with contextlib.suppress(Exception):
                        await storage.delete(file_id, audio_format.value)

        except Exception as e:
            logger.exception(f"upload {ctx.upload_id} failed with unexpected error")
            await job_service.update_progress(
                ctx.upload_id,
                JobStatus.FAILED,
                "upload failed",
                error=f"unexpected error: {e!s}",
            )
        finally:
            # cleanup temp files
            with contextlib.suppress(Exception):
                Path(ctx.file_path).unlink(missing_ok=True)
            if ctx.image_path:
                with contextlib.suppress(Exception):
                    Path(ctx.image_path).unlink(missing_ok=True)


@router.post("/")
@limiter.limit(settings.rate_limit.upload_limit)
async def upload_track(
    request: Request,
    title: Annotated[str, Form()],
    background_tasks: BackgroundTasks,
    auth_session: AuthSession = Depends(require_artist_profile),
    album: Annotated[str | None, Form()] = None,
    features: Annotated[str | None, Form()] = None,
    tags: Annotated[str | None, Form(description="JSON array of tag names")] = None,
    support_gate: Annotated[
        str | None,
        Form(description='JSON object for supporter gating, e.g., {"type": "any"}'),
    ] = None,
    file: UploadFile = File(...),
    image: UploadFile | None = File(None),
) -> dict:
    """Upload a new track (requires authentication and artist profile).

    Parameters:
        title: Track title (required).
        album: Optional album name/ID to associate with the track.
        features: Optional JSON array of ATProto handles, e.g.,
            ["user1.bsky.social", "user2.bsky.social"].
        support_gate: Optional JSON object for supporter gating.
            Requires atprotofans to be enabled in settings.
            Example: {"type": "any"} - requires any atprotofans support.
        file: Audio file to upload (required).
        image: Optional image file for track artwork.
        background_tasks: FastAPI background-task runner.
        auth_session: Authenticated artist session (dependency-injected).

    Returns:
        dict: A payload containing `upload_id` for monitoring progress via SSE.
    """
    # validate tags upfront before any processing
    try:
        validated_tags = parse_tags_json(tags)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    # parse and validate support_gate if provided
    parsed_support_gate: dict | None = None
    if support_gate:
        try:
            parsed_support_gate = json.loads(support_gate)
            if not isinstance(parsed_support_gate, dict):
                raise ValueError("support_gate must be a JSON object")
            if "type" not in parsed_support_gate:
                raise ValueError("support_gate must have a 'type' field")
            if parsed_support_gate["type"] not in ("any",):
                raise ValueError(
                    f"unsupported support_gate type: {parsed_support_gate['type']}"
                )
        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=400, detail=f"invalid support_gate JSON: {e}"
            ) from e
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

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
        image_content_type = None
        if image and image.filename:
            image_filename = image.filename
            image_content_type = image.content_type
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

        # create upload tracking via JobService
        upload_id = await job_service.create_job(
            JobType.UPLOAD, auth_session.did, "upload queued for processing"
        )

        # schedule background processing once response is sent
        ctx = UploadContext(
            upload_id=upload_id,
            auth_session=auth_session,
            file_path=file_path,
            filename=file.filename,
            title=title,
            artist_did=auth_session.did,
            album=album,
            features_json=features,
            tags=validated_tags,
            image_path=image_path,
            image_filename=image_filename,
            image_content_type=image_content_type,
            support_gate=parsed_support_gate,
        )
        background_tasks.add_task(_process_upload_background, ctx)
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
        # Polling loop
        try:
            while True:
                job = await job_service.get_job(upload_id)
                if not job:
                    # Job not found or lost
                    yield f"data: {json.dumps({'status': 'failed', 'message': 'upload job not found', 'error': 'job lost'})}\n\n"
                    break

                # Construct payload matching old UploadProgress.to_dict()
                payload = {
                    "upload_id": job.id,
                    "status": job.status,
                    "message": job.message,
                    "error": job.error,
                    "phase": job.phase,
                    "server_progress_pct": job.progress_pct,
                    "created_at": job.created_at.isoformat()
                    if job.created_at
                    else None,
                    "completed_at": job.completed_at.isoformat()
                    if job.completed_at
                    else None,
                }
                if job.result and "track_id" in job.result:
                    payload["track_id"] = job.result["track_id"]

                yield f"data: {json.dumps(payload)}\n\n"

                if job.status in (JobStatus.COMPLETED.value, JobStatus.FAILED.value):
                    break

                await asyncio.sleep(1.0)

        except Exception as e:
            logger.error(f"error in upload progress stream: {e}")
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
