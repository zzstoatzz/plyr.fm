"""Track upload endpoints and background processing."""

import asyncio
import contextlib
import json
import logging
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

import aiofiles
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
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session as AuthSession
from backend._internal import has_flag, require_artist_profile
from backend._internal.atproto import (
    BlobRef,
    PayloadTooLargeError,
    create_track_record,
    upload_blob,
)
from backend._internal.atproto.handles import resolve_featured_artists
from backend._internal.audio import AudioFormat
from backend._internal.clients.transcoder import get_transcoder_client
from backend._internal.image import ImageFormat
from backend._internal.jobs import job_service
from backend._internal.tasks import (
    schedule_album_list_sync,
    schedule_copyright_scan,
    schedule_embedding_generation,
    schedule_genre_classification,
)
from backend.config import settings
from backend.models import Artist, Track, UserPreferences
from backend.models.job import JobStatus, JobType
from backend.storage import storage
from backend.utilities.audio import extract_duration
from backend.utilities.database import db_session
from backend.utilities.hashing import CHUNK_SIZE
from backend.utilities.progress import R2ProgressTracker
from backend.utilities.rate_limit import limiter
from backend.utilities.tags import add_tags_to_track, parse_tags_json

from .router import router
from .services import get_or_create_album

logger = logging.getLogger(__name__)

PDS_AUDIO_UPLOADS_FLAG = "pds-audio-uploads"
PDS_AUDIO_UPLOADS_SETTING_KEY = "pds_audio_uploads_enabled"


class UploadStartResponse(BaseModel):
    """response when upload is queued for processing."""

    upload_id: str
    status: str
    message: str


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

    # auto-apply recommended genre tags after classification
    auto_tag: bool = False


@dataclass
class AudioInfo:
    """result of audio validation phase."""

    format: AudioFormat
    duration: int | None
    is_gated: bool


@dataclass
class StorageResult:
    """result of audio storage phase."""

    file_id: str
    original_file_id: str | None
    original_file_type: str | None
    playable_format: AudioFormat
    r2_url: str | None
    transcode_info: "TranscodeInfo | None"


class UploadPhaseError(Exception):
    """raised when an upload phase fails with a user-facing message."""

    def __init__(self, error: str) -> None:
        self.error = error
        super().__init__(error)


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


@dataclass
class TranscodeInfo:
    """result of transcoding an audio file."""

    original_file_id: str
    original_file_type: str
    transcoded_file_id: str
    transcoded_file_type: str
    transcoded_data: bytes


@dataclass
class PdsBlobResult:
    """result of attempting to upload a blob to user's PDS."""

    blob_ref: BlobRef | None
    cid: str | None
    size: int | None


async def _try_upload_to_pds(
    upload_id: str,
    auth_session: AuthSession,
    file_data: bytes,
    content_type: str,
) -> PdsBlobResult:
    """attempt to upload audio blob to user's PDS.

    this is a best-effort operation - if it fails due to size limits or other
    errors, we fall back to R2-only storage. the canonical audio data lives on
    the PDS when possible (embracing ATProto's data ownership ideals).

    args:
        upload_id: job tracking ID
        auth_session: authenticated user session
        file_data: audio file bytes (should match content_type)
        content_type: MIME type (e.g., audio/mpeg)

    returns:
        PdsBlobResult with blob_ref, cid, and size if successful, all None otherwise
    """
    await job_service.update_progress(
        upload_id,
        JobStatus.PROCESSING,
        "uploading to your PDS...",
        phase="pds_upload",
        progress_pct=0.0,
    )

    try:
        blob_ref = await upload_blob(auth_session, file_data, content_type)

        # extract CID from blob ref: {"ref": {"$link": "<CID>"}, ...}
        cid = blob_ref.get("ref", {}).get("$link")
        size = blob_ref.get("size")

        await job_service.update_progress(
            upload_id,
            JobStatus.PROCESSING,
            "uploaded to PDS",
            phase="pds_upload",
            progress_pct=100.0,
        )
        logfire.info(
            "pds blob upload succeeded",
            cid=cid,
            size=size,
            did=auth_session.did,
        )
        return PdsBlobResult(blob_ref=blob_ref, cid=cid, size=size)

    except PayloadTooLargeError as e:
        # expected: file exceeds PDS blob limit, gracefully fall back to R2-only
        logfire.info(
            "pds blob upload skipped: file too large",
            error=str(e),
            did=auth_session.did,
        )
        return PdsBlobResult(blob_ref=None, cid=None, size=None)

    # any other exception is unexpected - let it propagate to fail the upload


async def _should_upload_pds_blob(db: AsyncSession, user_did: str) -> bool:
    """check if PDS audio uploads are enabled for the user."""
    if not await has_flag(db, user_did, PDS_AUDIO_UPLOADS_FLAG):
        return False

    result = await db.execute(
        select(UserPreferences.ui_settings).where(UserPreferences.did == user_did)
    )
    ui_settings = result.scalar_one_or_none() or {}
    return bool(ui_settings.get(PDS_AUDIO_UPLOADS_SETTING_KEY))


async def _transcode_audio(
    upload_id: str,
    file_path: str,
    filename: str,
    source_format: str,
) -> TranscodeInfo | None:
    """transcode audio file to web-playable format.

    saves original to storage first, then transcodes. returns None on failure
    (job status already updated with error).

    args:
        upload_id: job tracking ID
        file_path: path to temp file
        filename: original filename
        source_format: source format (e.g., "aiff", "flac")

    returns:
        TranscodeInfo with both file IDs, or None on failure
    """
    # check if transcoding is enabled
    if not settings.transcoder.enabled:
        await job_service.update_progress(
            upload_id,
            JobStatus.FAILED,
            "upload failed",
            error="transcoding service is not enabled",
        )
        return None

    # save original file first
    await job_service.update_progress(
        upload_id,
        JobStatus.PROCESSING,
        "saving original file...",
        phase="upload_original",
        progress_pct=0.0,
    )

    try:
        async with R2ProgressTracker(
            job_id=upload_id,
            message="saving original file...",
            phase="upload_original",
        ) as tracker:
            with open(file_path, "rb") as file_obj:
                original_file_id = await storage.save(
                    file_obj, filename, progress_callback=tracker.on_progress
                )
    except Exception as e:
        logfire.error("failed to save original file", error=str(e), exc_info=True)
        await job_service.update_progress(
            upload_id, JobStatus.FAILED, "upload failed", error=str(e)
        )
        return None

    logfire.info("original file saved", file_id=original_file_id, format=source_format)

    # transcode to web-playable format (streams file to service, no memory load)
    await job_service.update_progress(
        upload_id,
        JobStatus.PROCESSING,
        "transcoding audio...",
        phase="transcode",
        progress_pct=0.0,
    )

    try:
        client = get_transcoder_client()
        result = await client.transcode_file(file_path, source_format)

        if not result.success or not result.data:
            await job_service.update_progress(
                upload_id,
                JobStatus.FAILED,
                "upload failed",
                error=f"transcoding failed: {result.error}",
            )
            # cleanup original
            with contextlib.suppress(Exception):
                await storage.delete(original_file_id, source_format)
            return None

    except Exception as e:
        logfire.error("transcode failed", error=str(e), exc_info=True)
        await job_service.update_progress(
            upload_id,
            JobStatus.FAILED,
            "upload failed",
            error=f"transcoding error: {e}",
        )
        # cleanup original
        with contextlib.suppress(Exception):
            await storage.delete(original_file_id, source_format)
        return None

    # save transcoded file
    target_format = settings.transcoder.target_format
    transcoded_filename = Path(filename).stem + f".{target_format}"

    try:
        import io

        async with R2ProgressTracker(
            job_id=upload_id,
            message="saving transcoded file...",
            phase="upload_transcoded",
        ) as tracker:
            transcoded_file_id = await storage.save(
                io.BytesIO(result.data),
                transcoded_filename,
                progress_callback=tracker.on_progress,
            )
    except Exception as e:
        logfire.error("failed to save transcoded file", error=str(e), exc_info=True)
        await job_service.update_progress(
            upload_id, JobStatus.FAILED, "upload failed", error=str(e)
        )
        # cleanup original
        with contextlib.suppress(Exception):
            await storage.delete(original_file_id, source_format)
        return None

    logfire.info(
        "transcoded file saved",
        file_id=transcoded_file_id,
        format=target_format,
    )

    return TranscodeInfo(
        original_file_id=original_file_id,
        original_file_type=source_format,
        transcoded_file_id=transcoded_file_id,
        transcoded_file_type=target_format,
        transcoded_data=result.data,
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


async def _validate_audio(ctx: UploadContext) -> AudioInfo:
    """phase 1: validate file type, extract duration, check gating requirements."""
    ext = Path(ctx.filename).suffix.lower()
    audio_format = AudioFormat.from_extension(ext)
    if not audio_format:
        raise UploadPhaseError(f"unsupported file type: {ext}")

    with open(ctx.file_path, "rb") as f:
        duration = extract_duration(f)

    is_gated = ctx.support_gate is not None
    if is_gated:
        async with db_session() as db:
            prefs_result = await db.execute(
                select(UserPreferences).where(UserPreferences.did == ctx.artist_did)
            )
            prefs = prefs_result.scalar_one_or_none()
            if not prefs or prefs.support_url != "atprotofans":
                raise UploadPhaseError(
                    "supporter gating requires atprotofans to be enabled in settings"
                )

    return AudioInfo(format=audio_format, duration=duration, is_gated=is_gated)


async def _store_audio(ctx: UploadContext, audio_info: AudioInfo) -> StorageResult:
    """phase 2: store audio (transcode if lossless)."""
    transcode_info: TranscodeInfo | None = None

    if not audio_info.format.is_web_playable:
        if audio_info.is_gated:
            raise UploadPhaseError(
                "supporter-gated tracks cannot use lossless formats yet"
            )

        original_ext = Path(ctx.filename).suffix.lower().lstrip(".")
        transcode_info = await _transcode_audio(
            ctx.upload_id, ctx.file_path, ctx.filename, original_ext
        )
        if not transcode_info:
            raise UploadPhaseError("transcoding failed")

        file_id = transcode_info.transcoded_file_id
        playable_format = AudioFormat.from_extension(
            transcode_info.transcoded_file_type
        )
        if not playable_format:
            raise UploadPhaseError("unknown transcoded format")
    else:
        file_id = await _save_audio_to_storage(
            ctx.upload_id, ctx.file_path, ctx.filename, gated=audio_info.is_gated
        )
        if not file_id:
            raise UploadPhaseError("failed to save audio to storage")
        playable_format = audio_info.format
        transcode_info = None

    # get R2 URL (only for public tracks)
    r2_url: str | None = None
    if not audio_info.is_gated:
        ext = Path(ctx.filename).suffix.lower()
        playable_ext = playable_format.value if playable_format else ext[1:]
        r2_url = await storage.get_url(
            file_id, file_type="audio", extension=playable_ext
        )
        if not r2_url:
            raise UploadPhaseError("failed to get public audio URL")

    return StorageResult(
        file_id=file_id,
        original_file_id=transcode_info.original_file_id if transcode_info else None,
        original_file_type=transcode_info.original_file_type
        if transcode_info
        else None,
        playable_format=playable_format,
        r2_url=r2_url,
        transcode_info=transcode_info,
    )


async def _check_duplicate(ctx: UploadContext, sr: StorageResult) -> None:
    """phase 3: check for duplicate tracks."""
    async with db_session() as db:
        result = await db.execute(
            select(Track).where(
                Track.file_id == sr.file_id,
                Track.artist_did == ctx.artist_did,
            )
        )
        if existing := result.scalar_one_or_none():
            raise UploadPhaseError(
                f"duplicate upload: track already exists (id: {existing.id})"
            )


async def _upload_to_pds(
    ctx: UploadContext, audio_info: AudioInfo, sr: StorageResult
) -> PdsBlobResult | None:
    """phase 4: upload to PDS (best-effort). returns None if skipped."""
    if audio_info.is_gated:
        return None

    async with db_session() as db:
        allow_pds_upload = await _should_upload_pds_blob(db, ctx.artist_did)
    if not allow_pds_upload:
        return None

    content_type = sr.playable_format.media_type
    if sr.transcode_info:
        pds_file_data = sr.transcode_info.transcoded_data
    else:
        async with aiofiles.open(ctx.file_path, "rb") as f:
            pds_file_data = await f.read()

    return await _try_upload_to_pds(
        ctx.upload_id, ctx.auth_session, pds_file_data, content_type
    )


async def _store_image(ctx: UploadContext) -> tuple[str | None, str | None]:
    """phase 5: store image (optional). returns (image_id, image_url)."""
    if not ctx.image_path or not ctx.image_filename:
        return None, None
    return await _save_image_to_storage(
        ctx.upload_id, ctx.image_path, ctx.image_filename, ctx.image_content_type
    )


async def _create_records(
    ctx: UploadContext,
    audio_info: AudioInfo,
    sr: StorageResult,
    pds_result: PdsBlobResult | None,
    image_id: str | None,
    image_url: str | None,
) -> Track:
    """phase 6: create ATProto record + DB track record."""
    ext = Path(ctx.filename).suffix.lower()
    playable_file_type = sr.playable_format.value if sr.playable_format else ext[1:]

    async with db_session() as db:
        result = await db.execute(select(Artist).where(Artist.did == ctx.artist_did))
        artist = result.scalar_one_or_none()
        if not artist:
            raise UploadPhaseError("artist profile not found")

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
            if audio_info.is_gated:
                from urllib.parse import urljoin

                backend_url = settings.atproto.redirect_uri.rsplit("/", 2)[0]
                audio_url_for_record = urljoin(backend_url + "/", f"audio/{sr.file_id}")
            else:
                assert sr.r2_url is not None
                audio_url_for_record = sr.r2_url

            atproto_result = await create_track_record(
                auth_session=ctx.auth_session,
                title=ctx.title,
                artist=artist.display_name,
                audio_url=audio_url_for_record,
                file_type=playable_file_type,
                album=ctx.album,
                duration=audio_info.duration,
                features=featured_artists or None,
                image_url=image_url,
                support_gate=ctx.support_gate,
                audio_blob=pds_result.blob_ref if pds_result else None,
            )
            if not atproto_result:
                raise ValueError("PDS returned no record data")
            atproto_uri, atproto_cid = atproto_result
        except Exception as e:
            logger.error("ATProto sync failed for upload %s: %s", ctx.upload_id, e)
            # cleanup orphaned media
            with contextlib.suppress(Exception):
                await storage.delete(sr.file_id, playable_file_type)
            if sr.original_file_id and sr.original_file_type:
                with contextlib.suppress(Exception):
                    await storage.delete(sr.original_file_id, sr.original_file_type)
            if image_id:
                with contextlib.suppress(Exception):
                    await storage.delete(image_id)
            raise UploadPhaseError(f"failed to sync track to ATProto: {e}") from e

        # create DB record
        await job_service.update_progress(
            ctx.upload_id,
            JobStatus.PROCESSING,
            "saving track metadata...",
            phase="database",
        )

        extra: dict = {}
        if audio_info.duration:
            extra["duration"] = audio_info.duration
        if ctx.auto_tag:
            extra["auto_tag"] = True

        album_record = None
        if ctx.album:
            extra["album"] = ctx.album
            album_record = await get_or_create_album(
                db, artist, ctx.album, image_id, image_url
            )

        has_pds_blob = pds_result and pds_result.cid is not None
        audio_storage = "both" if has_pds_blob else "r2"

        track = Track(
            title=ctx.title,
            file_id=sr.file_id,
            file_type=playable_file_type,
            original_file_id=sr.original_file_id,
            original_file_type=sr.original_file_type,
            artist_did=ctx.artist_did,
            extra=extra,
            album_id=album_record.id if album_record else None,
            features=featured_artists,
            r2_url=sr.r2_url,
            atproto_record_uri=atproto_uri,
            atproto_record_cid=atproto_cid,
            image_id=image_id,
            image_url=image_url,
            support_gate=ctx.support_gate,
            audio_storage=audio_storage,
            pds_blob_cid=pds_result.cid if pds_result else None,
            pds_blob_size=pds_result.size if pds_result else None,
        )

        db.add(track)
        try:
            await db.commit()
            await db.refresh(track)
        except IntegrityError as e:
            await db.rollback()
            with contextlib.suppress(Exception):
                await storage.delete(sr.file_id, playable_file_type)
            if sr.original_file_id and sr.original_file_type:
                with contextlib.suppress(Exception):
                    await storage.delete(sr.original_file_id, sr.original_file_type)
            raise UploadPhaseError(f"database constraint violation: {e!s}") from e

    return track


async def _schedule_post_upload(
    ctx: UploadContext, sr: StorageResult, track: Track
) -> None:
    """phase 7: post-upload tasks (tags, notifications, background jobs)."""
    async with db_session() as db:
        await add_tags_to_track(db, track.id, ctx.tags, ctx.artist_did)

        # skip notifications and copyright scan for integration tests on staging
        is_integration_test = (
            settings.observability.environment == "staging"
            and "integration-test" in (ctx.tags or [])
        )
        if not is_integration_test:
            await _send_track_notification(db, track)
        if sr.r2_url and not is_integration_test:
            await schedule_copyright_scan(track.id, sr.r2_url)

    # generate CLAP embedding for vibe search
    if sr.r2_url and settings.modal.enabled and settings.turbopuffer.enabled:
        await schedule_embedding_generation(track.id, sr.r2_url)

    # classify genres via Replicate
    if sr.r2_url and settings.replicate.enabled:
        await schedule_genre_classification(track.id, sr.r2_url)

    # sync album list record if track is in an album
    if track.album_id:
        await schedule_album_list_sync(ctx.auth_session.session_id, track.album_id)


async def _process_upload_background(ctx: UploadContext) -> None:
    """orchestrate the upload pipeline through named phases."""
    with logfire.span(
        "process upload background", upload_id=ctx.upload_id, filename=ctx.filename
    ):
        try:
            await job_service.update_progress(
                ctx.upload_id, JobStatus.PROCESSING, "processing upload..."
            )

            # phase 1: validate and prepare audio
            audio_info = await _validate_audio(ctx)

            # phase 2: store audio (transcode if lossless)
            sr = await _store_audio(ctx, audio_info)

            # phase 3: check for duplicates
            await _check_duplicate(ctx, sr)

            # phase 4: upload to PDS (best-effort)
            pds_result = await _upload_to_pds(ctx, audio_info, sr)

            # phase 5: store image (optional)
            image_id, image_url = await _store_image(ctx)

            # phase 6: create records (ATProto + DB)
            track = await _create_records(
                ctx, audio_info, sr, pds_result, image_id, image_url
            )

            # phase 7: post-upload tasks (tags, notifications, background jobs)
            await _schedule_post_upload(ctx, sr, track)

            await job_service.update_progress(
                ctx.upload_id,
                JobStatus.COMPLETED,
                "upload completed successfully",
                result={"track_id": track.id},
            )

        except UploadPhaseError as e:
            await job_service.update_progress(
                ctx.upload_id, JobStatus.FAILED, "upload failed", error=e.error
            )
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
    auto_tag: Annotated[
        str | None,
        Form(description="auto-apply recommended genre tags after classification"),
    ] = None,
    file: UploadFile = File(...),
    image: UploadFile | None = File(None),
) -> UploadStartResponse:
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

    # lossless formats (AIFF/FLAC) require feature flag
    if not audio_format.is_web_playable:
        async with db_session() as db:
            if not await has_flag(db, auth_session.did, "lossless-uploads"):
                raise HTTPException(
                    status_code=400,
                    detail=f"lossless format {ext} is not yet supported. "
                    "supported: .mp3, .wav, .m4a",
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
            auto_tag=auto_tag == "true",
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

    return UploadStartResponse(
        upload_id=upload_id,
        status="pending",
        message="upload queued for processing",
    )


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
