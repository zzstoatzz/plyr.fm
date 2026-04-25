"""Track upload endpoints and background processing."""

import asyncio
import contextlib
import json
import logging
import tempfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Annotated, Any, BinaryIO

import logfire
from docket import ConcurrencyLimit
from fastapi import (
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session as AuthSession
from backend._internal import get_session, require_artist_profile
from backend._internal.atproto import (
    BlobRef,
    PayloadTooLargeError,
    create_track_record,
    upload_blob,
)
from backend._internal.atproto.handles import resolve_featured_artists
from backend._internal.audio import AudioFormat
from backend._internal.background import get_docket
from backend._internal.clients.transcoder import get_transcoder_client
from backend._internal.image import ImageFormat
from backend._internal.jobs import job_service
from backend._internal.tasks import schedule_album_list_sync
from backend._internal.tasks.hooks import run_post_track_create_hooks
from backend._internal.thumbnails import generate_and_save
from backend.config import settings
from backend.models import Album, Artist, Track, UserPreferences
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

PDS_AUDIO_UPLOADS_SETTING_KEY = "pds_audio_uploads_enabled"


class UploadStartResponse(BaseModel):
    """response when upload is queued for processing."""

    upload_id: str
    status: str
    message: str


@dataclass
class UploadContext:
    """all data needed to process an upload in the background.

    audio + image bytes are staged to shared object storage by the HTTP
    handler BEFORE this context is enqueued. only stable shared-storage
    identifiers (file_id / image_id / URLs) and small primitives travel
    through the docket queue. no local filesystem paths cross the
    request → worker boundary, because a docket worker may pick up the
    task on a different fly machine than the one that handled the
    request — that machine has its own /tmp.
    """

    upload_id: str
    auth_session: AuthSession

    # audio (already in shared storage as `audio_file_id`; extension lives in `filename`)
    audio_file_id: str
    filename: str
    duration: int | None

    # track metadata
    title: str
    artist_did: str
    album: str | None  # legacy: album display name for get_or_create_album
    album_id: str | None  # new: explicit reference to an existing Album row
    features_json: str | None
    tags: list[str]

    # optional image (already in shared storage as `image_id`, plus computed URLs)
    image_id: str | None = None
    image_url: str | None = None
    thumbnail_url: str | None = None

    # track description (liner notes, show notes, etc.)
    description: str | None = None

    # supporter-gated content (e.g., {"type": "any"})
    support_gate: dict | None = None

    # auto-apply recommended genre tags after classification
    auto_tag: bool = False

    # visibility: unlisted tracks don't appear in discovery feeds
    unlisted: bool = False

    @property
    def audio_extension(self) -> str:
        """source-format extension, normalized (lowercase, no leading dot)."""
        return Path(self.filename).suffix.lower().lstrip(".")


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


async def stage_audio_to_storage(
    upload_id: str,
    file: BinaryIO | BytesIO,
    filename: str,
    *,
    gated: bool = False,
) -> str:
    """save staged audio bytes to object storage and return the resulting file_id.

    called from the HTTP handler BEFORE the docket task is enqueued. the
    returned file_id is what travels over Redis to the worker — the local
    temp file is discarded as soon as this function returns.

    raises on failure; the handler catches and surfaces a 5xx to the
    client, since the upload didn't durably land in storage.

    args:
        upload_id: job tracking ID
        file: binary stream positioned at the start of the audio bytes
        filename: original filename (extension determines bucket + media_type)
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
    async with R2ProgressTracker(
        job_id=upload_id,
        message=message,
        phase="upload",
    ) as tracker:
        if gated:
            file_id = await storage.save_gated(
                file, filename, progress_callback=tracker.on_progress
            )
        else:
            file_id = await storage.save(
                file, filename, progress_callback=tracker.on_progress
            )

    await job_service.update_progress(
        upload_id,
        JobStatus.PROCESSING,
        message,
        phase="upload",
        progress_pct=100.0,
    )
    logfire.info("audio staged to storage", file_id=file_id, gated=gated)
    return file_id


async def stage_image_to_storage(
    image_data: bytes,
    image_filename: str,
    image_content_type: str | None,
) -> tuple[str | None, str | None, str | None]:
    """save image bytes + thumbnail to object storage and return (image_id, image_url, thumbnail_url).

    called from the HTTP handler. returns (None, None, None) if the image
    format is unsupported or the save fails — the upload itself still
    proceeds without an image rather than failing the whole track.
    """
    image_format, is_valid = ImageFormat.validate_and_extract(
        image_filename, image_content_type
    )
    if not is_valid or not image_format:
        logger.warning(f"unsupported image format: {image_filename}")
        return None, None, None

    try:
        image_id = await storage.save(BytesIO(image_data), f"images/{image_filename}")
        image_url = await storage.get_url(image_id, file_type="image")
        thumbnail_url = await generate_and_save(image_data, image_id, "track")
        return image_id, image_url, thumbnail_url
    except Exception as e:
        logger.warning(f"failed to save image: {e}", exc_info=True)
        return None, None, None


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
    warning: str | None = None


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

    except Exception as e:
        # any other failure (timeout, network, auth) — fall back to R2-only.
        # PDS upload is best-effort; users can migrate via the portal later.
        logfire.warning(
            "pds blob upload failed, falling back to plyr.fm storage",
            error=f"{type(e).__name__}: {e}",
            did=auth_session.did,
        )
        return PdsBlobResult(
            blob_ref=None,
            cid=None,
            size=None,
            warning="couldn't upload to your PDS — stored on plyr.fm instead. you can migrate it later on the portal page.",
        )


async def _should_upload_pds_blob(db: AsyncSession, user_did: str) -> bool:
    """check if PDS audio uploads are enabled for the user (default: on)."""
    result = await db.execute(
        select(UserPreferences.ui_settings).where(UserPreferences.did == user_did)
    )
    ui_settings = result.scalar_one_or_none() or {}
    return ui_settings.get(PDS_AUDIO_UPLOADS_SETTING_KEY, True) is not False


async def _transcode_audio(
    upload_id: str,
    original_file_id: str,
    filename: str,
    source_format: str,
) -> TranscodeInfo | None:
    """transcode an already-staged audio file to a web-playable format.

    `original_file_id` points at the lossless source bytes already in
    object storage (the HTTP handler put them there before enqueueing
    the docket task). we download those bytes, hand them to the
    transcoder service via a worker-local temp file, and save the
    transcoded result back. returns None on failure (job status already
    updated with error).

    args:
        upload_id: job tracking ID
        original_file_id: storage file_id for the lossless source bytes
        filename: original filename (used to derive transcoded filename)
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

    # fetch the lossless source bytes from storage
    source_data = await storage.get_file_data(original_file_id, source_format)
    if not source_data:
        logfire.error(
            "transcode aborted: source file missing from storage",
            file_id=original_file_id,
            format=source_format,
        )
        await job_service.update_progress(
            upload_id,
            JobStatus.FAILED,
            "upload failed",
            error="staged audio file missing from storage",
        )
        return None

    logfire.info(
        "loaded source bytes for transcode",
        file_id=original_file_id,
        format=source_format,
        size_bytes=len(source_data),
    )

    # transcode to web-playable format. the transcoder client streams from a
    # file path; spool the bytes to a worker-local temp file. this temp file
    # is created and deleted entirely on this worker — it never crosses the
    # request → worker boundary, so the multi-machine fly setup is fine.
    await job_service.update_progress(
        upload_id,
        JobStatus.PROCESSING,
        "transcoding audio...",
        phase="transcode",
        progress_pct=0.0,
    )

    spool_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=f".{source_format}"
        ) as spool:
            spool_path = spool.name
            spool.write(source_data)

        client = get_transcoder_client()
        result = await client.transcode_file(spool_path, source_format)

        if not result.success or not result.data:
            await job_service.update_progress(
                upload_id,
                JobStatus.FAILED,
                "upload failed",
                error=f"transcoding failed: {result.error}",
            )
            return None

    except Exception as e:
        logfire.error("transcode failed", error=str(e), exc_info=True)
        await job_service.update_progress(
            upload_id,
            JobStatus.FAILED,
            "upload failed",
            error=f"transcoding error: {e}",
        )
        return None
    finally:
        if spool_path:
            with contextlib.suppress(Exception):
                Path(spool_path).unlink(missing_ok=True)

    # save transcoded file
    target_format = settings.transcoder.target_format
    transcoded_filename = Path(filename).stem + f".{target_format}"

    try:
        async with R2ProgressTracker(
            job_id=upload_id,
            message="saving transcoded file...",
            phase="upload_transcoded",
        ) as tracker:
            transcoded_file_id = await storage.save(
                BytesIO(result.data),
                transcoded_filename,
                progress_callback=tracker.on_progress,
            )
    except Exception as e:
        logfire.error("failed to save transcoded file", error=str(e), exc_info=True)
        await job_service.update_progress(
            upload_id, JobStatus.FAILED, "upload failed", error=str(e)
        )
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


async def _validate_audio(ctx: UploadContext) -> AudioInfo:
    """phase 1: validate file type, propagate handler-extracted duration, check gating.

    duration is extracted in the HTTP handler (where the bytes are already
    in memory or on local /tmp), then carried through `ctx.duration`. the
    worker doesn't need to re-fetch the audio bytes just to read length
    metadata. format validation here is the cheap extension check; the
    handler already rejected unknown extensions before staging.
    """
    audio_format = AudioFormat.from_extension(f".{ctx.audio_extension}")
    if not audio_format:
        raise UploadPhaseError(f"unsupported file type: .{ctx.audio_extension}")

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

    return AudioInfo(format=audio_format, duration=ctx.duration, is_gated=is_gated)


async def _store_audio(ctx: UploadContext, audio_info: AudioInfo) -> StorageResult:
    """phase 2: settle on the playable file_id, transcoding if the staged audio is lossless.

    the staged file_id (already in storage from the HTTP handler) is the
    starting point. for web-playable formats we use it directly. for
    lossless formats we keep the staged file as the `original_file_id`
    and produce a transcoded sibling.
    """
    transcode_info: TranscodeInfo | None = None

    if not audio_info.format.is_web_playable:
        if audio_info.is_gated:
            raise UploadPhaseError(
                "supporter-gated tracks cannot use lossless formats yet"
            )

        # the handler-staged file_id IS the lossless original. transcoding
        # downloads it from storage, produces the playable sibling, and
        # registers the staged id as `original_file_id`.
        transcode_info = await _transcode_audio(
            ctx.upload_id, ctx.audio_file_id, ctx.filename, ctx.audio_extension
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
        # web-playable: staged file_id is already the playable file. for
        # gated tracks we still need it in the private bucket — gating
        # is decided at the handler boundary, so the staged file already
        # lives in the right place.
        file_id = ctx.audio_file_id
        playable_format = audio_info.format
        transcode_info = None

    # public-bucket URL (gated tracks proxy through the auth-protected backend)
    r2_url: str | None = None
    if not audio_info.is_gated:
        playable_ext = playable_format.value if playable_format else ctx.audio_extension
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
    """phase 4: upload to PDS (best-effort). returns None if skipped.

    when the source was transcoded, the playable bytes are already in
    memory (`sr.transcode_info.transcoded_data`). otherwise we download
    the playable bytes from storage — there's no machine-local temp file
    to read from in the worker.
    """
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
        playable_ext = (
            sr.playable_format.value if sr.playable_format else ctx.audio_extension
        )
        fetched = await storage.get_file_data(sr.file_id, playable_ext)
        if fetched is None:
            logfire.warning(
                "pds blob upload skipped: file not found in storage",
                file_id=sr.file_id,
                file_type=playable_ext,
            )
            return None
        pds_file_data = fetched

    return await _try_upload_to_pds(
        ctx.upload_id, ctx.auth_session, pds_file_data, content_type
    )


async def _store_image(
    ctx: UploadContext,
) -> tuple[str | None, str | None, str | None]:
    """phase 5: surface the staged image URLs (no I/O — bytes already in storage).

    the HTTP handler stages the image to storage and computes both the
    image URL and the thumbnail URL before enqueueing the docket task.
    by the time the worker reaches this phase, there is nothing to do but
    forward those identifiers into the ATProto record.
    """
    return ctx.image_id, ctx.image_url, ctx.thumbnail_url


async def _create_records(
    ctx: UploadContext,
    audio_info: AudioInfo,
    sr: StorageResult,
    pds_result: PdsBlobResult | None,
    image_id: str | None,
    image_url: str | None,
    thumbnail_url: str | None = None,
) -> tuple[Track, bool]:
    """phase 6: reserve DB row, create ATProto record, finalize.

    uses reserve-then-publish to avoid races with Jetstream ingest:
    1. generate rkey (TID) upfront and reserve the DB row as "pending"
    2. publish to PDS with explicit rkey via putRecord
    3. atomic CAS update pending → published (only winner runs hooks)

    returns:
        (track, published_by_us) — published_by_us is False if Jetstream
        ingest finalized the row before we could.
    """
    from datetime import UTC, datetime

    from backend._internal.atproto.tid import datetime_to_tid

    ext = Path(ctx.filename).suffix.lower()
    playable_file_type = sr.playable_format.value if sr.playable_format else ext[1:]

    # compute audio URL for ATProto record
    if audio_info.is_gated:
        from urllib.parse import urljoin

        backend_url = settings.atproto.redirect_uri.rsplit("/", 2)[0]
        audio_url_for_record = urljoin(backend_url + "/", f"audio/{sr.file_id}")
    else:
        assert sr.r2_url is not None
        audio_url_for_record = sr.r2_url

    # generate deterministic rkey and AT URI
    created_at = datetime.now(UTC)
    rkey = datetime_to_tid(created_at)
    collection = settings.atproto.track_collection
    uri = f"at://{ctx.artist_did}/{collection}/{rkey}"

    # step 1: reserve DB row as pending
    await job_service.update_progress(
        ctx.upload_id,
        JobStatus.PROCESSING,
        "saving track metadata...",
        phase="database",
    )

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

        # if an explicit album_id was passed, resolve the album up front so the
        # ATProto track record includes the correct album title and the row is
        # linked at creation (instead of the legacy defer-until-after-PDS flow).
        album_row: Album | None = None
        if ctx.album_id:
            album_lookup = await db.execute(
                select(Album).where(Album.id == ctx.album_id)
            )
            album_row = album_lookup.scalar_one_or_none()
            if not album_row:
                raise UploadPhaseError(f"album {ctx.album_id} not found")
            if album_row.artist_did != ctx.artist_did:
                raise UploadPhaseError("album does not belong to this artist")
            # sync the display name so build_track_record embeds the right value
            ctx.album = album_row.title

        extra: dict = {}
        if audio_info.duration:
            extra["duration"] = audio_info.duration
        if ctx.auto_tag:
            extra["auto_tag"] = True
        if ctx.album:
            extra["album"] = ctx.album

        has_pds_blob = pds_result and pds_result.cid is not None
        audio_storage = "both" if has_pds_blob else "r2"

        artist_display_name = artist.display_name

        # album creation deferred to after PDS success to avoid orphan albums
        # (legacy path only — new path uses album_row set above)
        track = Track(
            title=ctx.title,
            file_id=sr.file_id,
            file_type=playable_file_type,
            original_file_id=sr.original_file_id,
            original_file_type=sr.original_file_type,
            artist_did=ctx.artist_did,
            description=ctx.description,
            extra=extra,
            album_id=album_row.id if album_row else None,
            features=featured_artists,
            r2_url=sr.r2_url,
            atproto_record_uri=uri,
            atproto_record_cid=None,
            created_at=created_at,
            publish_state="pending",
            image_id=image_id,
            image_url=image_url,
            thumbnail_url=thumbnail_url,
            support_gate=ctx.support_gate,
            unlisted=ctx.unlisted,
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

        track_id = track.id

    # step 2: publish to PDS with explicit rkey (putRecord for idempotency)
    await job_service.update_progress(
        ctx.upload_id,
        JobStatus.PROCESSING,
        "creating atproto record...",
        phase="atproto",
    )
    try:
        atproto_result = await create_track_record(
            auth_session=ctx.auth_session,
            title=ctx.title,
            artist=artist_display_name,
            audio_url=audio_url_for_record,
            file_type=playable_file_type,
            album=ctx.album,
            duration=audio_info.duration,
            features=featured_artists or None,
            image_url=image_url,
            support_gate=ctx.support_gate,
            audio_blob=pds_result.blob_ref if pds_result else None,
            description=ctx.description,
            rkey=rkey,
            created_at=created_at,
        )
        if not atproto_result:
            raise ValueError("PDS returned no record data")
        _, atproto_cid = atproto_result
    except Exception as e:
        # always include the exception type in the surfaced message — some
        # exception classes (notably httpx.RemoteProtocolError with an empty
        # h11 reason) stringify to "", which makes downstream error logs and
        # the failed-job error field useless.
        err_detail = f"{type(e).__name__}: {e!s}" if str(e) else type(e).__name__
        logger.error("ATProto sync failed for upload %s: %s", ctx.upload_id, err_detail)
        # only delete the row if it's still pending — on ambiguous failures
        # (timeouts, connection drops) Jetstream may have already finalized it
        deleted_pending = False
        with contextlib.suppress(Exception):
            async with db_session() as db:
                result = await db.execute(
                    delete(Track).where(
                        Track.id == track_id, Track.publish_state == "pending"
                    )
                )
                await db.commit()
                deleted_pending = result.rowcount == 1  # type: ignore[union-attr]

        if deleted_pending:
            # row was still pending — safe to clean up media
            with contextlib.suppress(Exception):
                await storage.delete(sr.file_id, playable_file_type)
            if sr.original_file_id and sr.original_file_type:
                with contextlib.suppress(Exception):
                    await storage.delete(sr.original_file_id, sr.original_file_type)
            if image_id:
                with contextlib.suppress(Exception):
                    await storage.delete(image_id)
        # else: Jetstream finalized the row — media belongs to the published track

        raise UploadPhaseError(f"failed to sync track to ATProto: {err_detail}") from e

    # step 3: atomic CAS update pending → published + deferred album linkage
    async with db_session() as db:
        # legacy path: create album now that PDS write succeeded (avoids orphan
        # albums on failure). the new explicit-album_id path has already linked
        # the track to its album at row-creation time, so this block is skipped.
        album_record = None
        if ctx.album and not ctx.album_id:
            artist_row = await db.execute(
                select(Artist).where(Artist.did == ctx.artist_did)
            )
            artist_obj = artist_row.scalar_one()
            album_record, album_created = await get_or_create_album(
                db, artist_obj, ctx.album, image_id, image_url
            )

            if album_created:
                from backend.models import CollectionEvent

                db.add(
                    CollectionEvent(
                        event_type="album_release",
                        actor_did=ctx.artist_did,
                        album_id=album_record.id,
                    )
                )

        values: dict = {
            "atproto_record_cid": atproto_cid,
            "publish_state": "published",
        }
        if album_record:
            values["album_id"] = album_record.id

        result = await db.execute(
            update(Track)
            .where(Track.id == track_id, Track.publish_state == "pending")
            .values(**values)
        )
        await db.commit()
        published_by_us = result.rowcount == 1  # type: ignore[union-attr]

        # reload the finalized track
        row = await db.execute(select(Track).where(Track.id == track_id))
        track = row.scalar_one()

    return track, published_by_us


async def _schedule_post_upload(
    ctx: UploadContext,
    sr: StorageResult,
    track: Track,
    *,
    run_hooks: bool = True,
) -> None:
    """phase 7: post-upload tasks (tags, album sync, shared hooks).

    run_hooks is False when Jetstream ingest already finalized the pending
    row and ran hooks before us (race condition — hooks only run once).
    """
    async with db_session() as db:
        await add_tags_to_track(db, track.id, ctx.tags, ctx.artist_did)

    # upload-specific: album list sync (legacy path only — the explicit
    # album_id path defers list creation to POST /albums/{id}/finalize so the
    # record is written once with the user-intended order instead of racing
    # per-track sync tasks on `created_at`)
    if track.album_id and not ctx.album_id:
        await schedule_album_list_sync(ctx.auth_session.session_id, track.album_id)
        from backend.api.albums import invalidate_album_cache_by_id

        async with db_session() as db:
            await invalidate_album_cache_by_id(db, track.album_id)
    elif track.album_id and ctx.album_id:
        # still invalidate cache so the album page reflects the new track once
        # finalize runs
        from backend.api.albums import invalidate_album_cache_by_id

        async with db_session() as db:
            await invalidate_album_cache_by_id(db, track.album_id)

    if not run_hooks:
        return

    # shared post-creation hooks
    is_integration_test = (
        settings.observability.environment == "staging"
        and "integration-test" in (ctx.tags or [])
    )
    await run_post_track_create_hooks(
        track.id,
        audio_url=sr.r2_url,
        skip_notification=is_integration_test,
        skip_copyright=is_integration_test,
    )


async def _delete_staged_audio(
    file_id: str, file_type: str | None, *, gated: bool
) -> None:
    """suppressed delete for audio bytes the user uploaded to a bucket
    chosen at handler-staging time. `gated` selects the bucket so we
    don't no-op-delete from public when the file actually lives in
    private (or vice versa).
    """
    delete_fn = storage.delete_gated if gated else storage.delete
    with contextlib.suppress(Exception):
        await delete_fn(file_id, file_type)


async def _cleanup_staged_media_pre_db(
    ctx: UploadContext, sr: StorageResult | None
) -> None:
    """delete storage objects staged for an upload that aborts BEFORE
    `_create_records` reserves a DB row. once a row exists the row owns
    the media — `_create_records` has its own pending/finalized
    cleanup logic; the orchestrator must not run this past that
    boundary or it'll yank media out from under a committed row.
    """
    is_gated = ctx.support_gate is not None

    if sr is not None and sr.transcode_info is not None:
        # transcode produced a new sibling. the playable sibling lives
        # in the public bucket (gated lossless is rejected upstream),
        # and the staged source is now `original_file_id` (also public).
        playable_ext = sr.playable_format.value if sr.playable_format else None
        with contextlib.suppress(Exception):
            await storage.delete(sr.file_id, playable_ext)
        if sr.original_file_id:
            with contextlib.suppress(Exception):
                await storage.delete(sr.original_file_id, sr.original_file_type)
    else:
        # `_store_audio` either didn't run, or returned the staged file
        # as-is (web-playable). either way, only ctx.audio_file_id is
        # in storage, in the bucket the handler chose.
        await _delete_staged_audio(
            ctx.audio_file_id, ctx.audio_extension, gated=is_gated
        )

    if ctx.image_id:
        with contextlib.suppress(Exception):
            await storage.delete(ctx.image_id)


async def _process_upload_background(ctx: UploadContext) -> None:
    """orchestrate the upload pipeline through named phases.

    cleanup discipline: the HTTP handler stages audio + image to shared
    storage before enqueueing this task, so by the time we get here
    those objects are durable and orphan-able. failures in phases 1-5
    delete the staged objects (no DB row exists yet); failures from
    phase 6 onward defer to `_create_records`'s reserve-then-publish
    cleanup, since once the row is committed the row owns the media.
    """
    sr: StorageResult | None = None
    db_row_owns_media = False

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

            # reload session in case PDS upload refreshed the token
            if pds_result and (
                refreshed := await get_session(ctx.auth_session.session_id)
            ):
                ctx.auth_session = refreshed

            # phase 5: store image (optional)
            image_id, image_url, thumbnail_url = await _store_image(ctx)

            # phase 6: reserve DB row, create ATProto record, finalize.
            # past this boundary, _create_records owns the media via the
            # reserve-then-publish flow (it deletes staged objects on
            # ATProto failure when the pending row was still ours, and
            # leaves them when Jetstream finalized). the orchestrator
            # must not re-delete from here on.
            db_row_owns_media = True
            track, published_by_us = await _create_records(
                ctx, audio_info, sr, pds_result, image_id, image_url, thumbnail_url
            )

            # phase 7: post-upload tasks (tags, album sync, shared hooks)
            await _schedule_post_upload(ctx, sr, track, run_hooks=published_by_us)

            result: dict[str, Any] = {
                "track_id": track.id,
                "atproto_uri": track.atproto_record_uri,
                "atproto_cid": track.atproto_record_cid,
            }
            if pds_result and pds_result.warning:
                result["warnings"] = [pds_result.warning]

            await job_service.update_progress(
                ctx.upload_id,
                JobStatus.COMPLETED,
                "upload completed successfully",
                result=result,
            )

        except UploadPhaseError as e:
            if not db_row_owns_media:
                await _cleanup_staged_media_pre_db(ctx, sr)
            await job_service.update_progress(
                ctx.upload_id, JobStatus.FAILED, "upload failed", error=e.error
            )
        except Exception as e:
            logger.exception(f"upload {ctx.upload_id} failed with unexpected error")
            if not db_row_owns_media:
                await _cleanup_staged_media_pre_db(ctx, sr)
            await job_service.update_progress(
                ctx.upload_id,
                JobStatus.FAILED,
                "upload failed",
                error=f"unexpected error: {e!s}",
            )

        # NB: no temp-file cleanup here. the worker never receives a
        # filesystem path — audio + image are staged to shared object
        # storage by the HTTP handler, and identifiers are what travel
        # over the docket queue. cleanup of the handler's request-local
        # temp file lives in the handler's `try/finally` instead.


async def run_track_upload(
    upload_id: str,
    session_id: str,
    audio_file_id: str,
    filename: str,
    duration: int | None,
    title: str,
    artist_did: str,
    album: str | None,
    album_id: str | None,
    features_json: str | None,
    tags: list[str],
    description: str | None,
    image_id: str | None,
    image_url: str | None,
    thumbnail_url: str | None,
    support_gate: dict | None,
    auto_tag: bool,
    unlisted: bool,
    concurrency: ConcurrencyLimit = ConcurrencyLimit("artist_did", max_concurrent=3),
) -> None:
    """docket task entry point for track uploads.

    takes primitive args + shared-storage identifiers (file_id, image_id —
    everything that survives Redis serialization and is reachable from
    any worker, regardless of which fly machine the request landed on).
    rehydrates the auth session from the stored session_id, constructs an
    UploadContext, and delegates to the phase orchestrator
    (`_process_upload_background`).

    **never accept filesystem paths here.** prior to 2026-04 we passed
    `/tmp/...` paths through this signature; uploads silently failed
    when the docket worker landed on a different machine than the request
    handler (different /tmp). the handler now stages audio + image to
    shared storage before enqueueing, and we work from those identifiers.

    rehydrating the session at task start rather than passing the cached
    AuthSession over the wire means we pick up any token refresh that
    happened between the HTTP request and the worker picking up the task.

    the `ConcurrencyLimit("artist_did", max_concurrent=3)` caps concurrent
    uploads per user's DID at 3. a 12-track album upload does not produce
    12 parallel `createRecord` calls against the user's PDS (which would
    exceed the typical PDS's connection-limit + rate-limit tolerance and
    cause ConnectTimeouts). instead the task queue trickles uploads
    through 3 at a time. user-visible latency for the slowest track in a
    large album goes up, but every track publishes successfully rather
    than 1-2 silently failing on upstream PDS throttling.
    """
    auth_session = await get_session(session_id)
    if auth_session is None:
        # session expired or was revoked between HTTP request and task start.
        # the upload can't proceed (no PDS to publish to) and won't recover
        # without a fresh sign-in, so clean up the staged storage objects
        # rather than leaving them as durable orphans.
        is_gated = support_gate is not None
        await _delete_staged_audio(
            audio_file_id,
            Path(filename).suffix.lower().lstrip(".") or None,
            gated=is_gated,
        )
        if image_id:
            with contextlib.suppress(Exception):
                await storage.delete(image_id)
        await job_service.update_progress(
            upload_id,
            JobStatus.FAILED,
            "upload failed",
            error="authentication session expired before processing could begin",
        )
        return

    ctx = UploadContext(
        upload_id=upload_id,
        auth_session=auth_session,
        audio_file_id=audio_file_id,
        filename=filename,
        duration=duration,
        title=title,
        artist_did=artist_did,
        album=album,
        album_id=album_id,
        features_json=features_json,
        tags=tags,
        description=description,
        image_id=image_id,
        image_url=image_url,
        thumbnail_url=thumbnail_url,
        support_gate=support_gate,
        auto_tag=auto_tag,
        unlisted=unlisted,
    )
    await _process_upload_background(ctx)


async def schedule_track_upload(ctx: UploadContext) -> None:
    """enqueue a track upload as a docket task.

    by contract this function only forwards small primitives + storage
    identifiers — never local filesystem paths. a worker may pick up
    the task on a different fly machine than the one that handled the
    request, and that machine has its own /tmp.

    the HTTP handler should return to the client as soon as this call
    resolves; the actual transcode/PDS/ATProto work runs on a docket
    worker with bounded concurrency (`settings.docket.worker_concurrency`),
    which prevents a burst of simultaneous uploads from saturating the
    DB pool.
    """
    docket = get_docket()
    await docket.add(run_track_upload)(
        upload_id=ctx.upload_id,
        session_id=ctx.auth_session.session_id,
        audio_file_id=ctx.audio_file_id,
        filename=ctx.filename,
        duration=ctx.duration,
        title=ctx.title,
        artist_did=ctx.artist_did,
        album=ctx.album,
        album_id=ctx.album_id,
        features_json=ctx.features_json,
        tags=ctx.tags,
        description=ctx.description,
        image_id=ctx.image_id,
        image_url=ctx.image_url,
        thumbnail_url=ctx.thumbnail_url,
        support_gate=ctx.support_gate,
        auto_tag=ctx.auto_tag,
        unlisted=ctx.unlisted,
    )


@router.post("/")
@limiter.limit(settings.rate_limit.upload_limit)
async def upload_track(
    request: Request,
    title: Annotated[str, Form()],
    auth_session: AuthSession = Depends(require_artist_profile),
    album: Annotated[str | None, Form()] = None,
    album_id: Annotated[
        str | None,
        Form(
            description="explicit album id to attach to (mutually exclusive with album)"
        ),
    ] = None,
    features: Annotated[str | None, Form()] = None,
    tags: Annotated[str | None, Form(description="JSON array of tag names")] = None,
    support_gate: Annotated[
        str | None,
        Form(description='JSON object for supporter gating, e.g., {"type": "any"}'),
    ] = None,
    description: Annotated[
        str | None,
        Form(description="Track description (liner notes, show notes, etc.)"),
    ] = None,
    auto_tag: Annotated[
        str | None,
        Form(description="auto-apply recommended genre tags after classification"),
    ] = None,
    unlisted: Annotated[
        str | None,
        Form(
            description="set to 'true' to exclude from discovery feeds (latest, top, for-you)"
        ),
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
        auth_session: Authenticated artist session (dependency-injected).

    Returns:
        dict: A payload containing `upload_id` for monitoring progress via SSE.
    """
    # album and album_id are mutually exclusive
    if album and album_id:
        raise HTTPException(
            status_code=400,
            detail="album and album_id are mutually exclusive — provide one or the other",
        )

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

    # stage audio + image to shared object storage BEFORE enqueueing the
    # docket task. only stable file_ids travel over Redis to the worker —
    # docket workers are not co-located with the request handler in
    # production, and a /tmp path on machine A is meaningless on machine B.
    #
    # the handler now creates durable storage objects before any worker
    # has taken ownership, so any abort between staging and a successful
    # enqueue must roll those objects back AND mark the job FAILED —
    # otherwise we'd leak audio/image bytes and leave the user's job stuck
    # in PROCESSING forever.
    upload_id = await job_service.create_job(
        JobType.UPLOAD, auth_session.did, "upload queued for processing"
    )
    is_gated = parsed_support_gate is not None
    audio_extension = ext.lstrip(".") or None

    file_path: str | None = None
    audio_file_id: str | None = None
    image_id: str | None = None
    image_url: str | None = None
    thumbnail_url: str | None = None
    enqueued = False
    try:
        max_size = settings.storage.max_upload_size_mb * 1024 * 1024
        bytes_read = 0
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp_file:
            file_path = tmp_file.name
            while chunk := await file.read(CHUNK_SIZE):
                bytes_read += len(chunk)
                if bytes_read > max_size:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"file too large (max "
                            f"{settings.storage.max_upload_size_mb}MB)"
                        ),
                    )
                tmp_file.write(chunk)

        # extract duration once, while the bytes are still local — saves
        # the worker an extra storage round-trip just to read length metadata.
        with open(file_path, "rb") as f:
            duration = extract_duration(f)

        # stage audio bytes to shared storage
        with open(file_path, "rb") as f:
            audio_file_id = await stage_audio_to_storage(
                upload_id, f, file.filename, gated=is_gated
            )

        # stage image bytes to shared storage (best-effort; missing or
        # invalid images don't fail the whole upload — the orchestrator
        # treats `image_id is None` as "no track artwork").
        if image and image.filename:
            max_image_size = 20 * 1024 * 1024
            image_buffer = BytesIO()
            image_bytes_read = 0
            while chunk := await image.read(CHUNK_SIZE):
                image_bytes_read += len(chunk)
                if image_bytes_read > max_image_size:
                    raise HTTPException(
                        status_code=413,
                        detail="image too large (max 20MB)",
                    )
                image_buffer.write(chunk)
            image_id, image_url, thumbnail_url = await stage_image_to_storage(
                image_buffer.getvalue(), image.filename, image.content_type
            )

        ctx = UploadContext(
            upload_id=upload_id,
            auth_session=auth_session,
            audio_file_id=audio_file_id,
            filename=file.filename,
            duration=duration,
            title=title,
            artist_did=auth_session.did,
            album=album,
            album_id=album_id,
            features_json=features,
            tags=validated_tags,
            description=description,
            image_id=image_id,
            image_url=image_url,
            thumbnail_url=thumbnail_url,
            support_gate=parsed_support_gate,
            auto_tag=auto_tag == "true",
            unlisted=unlisted == "true",
        )
        await schedule_track_upload(ctx)
        enqueued = True
    except Exception:
        if not enqueued:
            if audio_file_id:
                await _delete_staged_audio(
                    audio_file_id, audio_extension, gated=is_gated
                )
            if image_id:
                with contextlib.suppress(Exception):
                    await storage.delete(image_id)
            with contextlib.suppress(Exception):
                await job_service.update_progress(
                    upload_id,
                    JobStatus.FAILED,
                    "upload failed",
                    error="upload aborted before queueing",
                )
        raise
    finally:
        # the request-local temp file lives only inside this handler
        # invocation. cleaning it up here means there's never a path for
        # the worker to pick up — and never a /tmp leak if enqueue fails.
        if file_path:
            with contextlib.suppress(Exception):
                Path(file_path).unlink(missing_ok=True)

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
                if job.result and "warnings" in job.result:
                    payload["warnings"] = job.result["warnings"]
                # surface the PDS strongRef so album upload callers can build
                # items[] arrays without a follow-up DB query (see #1260).
                # background writes these to job.result in _process_upload_background;
                # without this whitelist entry they never reach the SSE stream.
                if job.result and "atproto_uri" in job.result:
                    payload["atproto_uri"] = job.result["atproto_uri"]
                if job.result and "atproto_cid" in job.result:
                    payload["atproto_cid"] = job.result["atproto_cid"]

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
