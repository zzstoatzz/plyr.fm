"""tracks api endpoints."""

import asyncio
import contextlib
import json
import logging
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Annotated, Any

import logfire
from fastapi import (
    APIRouter,
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
from sqlalchemy.orm import attributes, selectinload

from backend._internal import Session as AuthSession
from backend._internal import oauth_client, require_artist_profile, require_auth
from backend._internal.atproto import (
    create_like_record,
    create_track_record,
    delete_record_by_uri,
)
from backend._internal.atproto.handles import resolve_handle
from backend._internal.atproto.records import (
    _reconstruct_oauth_session,
    _refresh_session_tokens,
    build_track_record,
    update_record,
)
from backend._internal.atproto.tid import datetime_to_tid
from backend._internal.audio import AudioFormat
from backend._internal.auth import get_session
from backend._internal.image import ImageFormat
from backend._internal.uploads import UploadStatus, upload_tracker
from backend.config import settings
from backend.models import Artist, Track, TrackLike, get_db
from backend.storage import storage
from backend.storage.r2 import R2Storage
from backend.utilities.aggregations import get_like_counts
from backend.utilities.database import db_session
from backend.utilities.hashing import CHUNK_SIZE

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tracks", tags=["tracks"])


class TrackResponse(dict):
    """track response schema."""

    @classmethod
    async def from_track(
        cls,
        track: Track,
        pds_url: str | None = None,
        liked_track_ids: set[int] | None = None,
        like_counts: dict[int, int] | None = None,
    ) -> "TrackResponse":
        """build track response from Track model.

        args:
            track: Track model instance
            pds_url: optional PDS URL for atproto_record_url
            liked_track_ids: optional set of liked track IDs for this user (for efficient batched checks)
            like_counts: optional dict of track_id -> like_count (from batch aggregation)
        """
        # check if user has liked this track (efficient O(1) lookup)
        is_liked = liked_track_ids is not None and track.id in liked_track_ids

        # get like count (defaults to 0 if not in dict)
        like_count = like_counts.get(track.id, 0) if like_counts else 0

        # use stored image_url if available, fallback to computing it for legacy records
        image_url = track.image_url
        if not image_url and track.image_id:
            image_url = await track.get_image_url()

        return cls(
            id=track.id,
            title=track.title,
            artist=track.artist.display_name,
            artist_handle=track.artist.handle,
            artist_avatar_url=track.artist.avatar_url,
            album=track.album,
            file_id=track.file_id,
            file_type=track.file_type,
            features=track.features,
            r2_url=track.r2_url,
            atproto_record_uri=track.atproto_record_uri,
            atproto_record_url=(
                f"{pds_url}/xrpc/com.atproto.repo.getRecord"
                f"?repo={track.artist_did}&collection={settings.atproto.track_collection}"
                f"&rkey={track.atproto_record_uri.split('/')[-1]}"
                if track.atproto_record_uri and pds_url
                else None
            ),
            play_count=track.play_count,
            created_at=track.created_at.isoformat(),
            image_url=image_url,
            is_liked=is_liked,
            like_count=like_count,
        )


# max featured artists per track
MAX_FEATURES = 5


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
    """background task to process upload."""
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
                upload_id, UploadStatus.PROCESSING, "saving audio file..."
            )
            try:
                logfire.info("preparing to save audio file", filename=filename)
                with open(file_path, "rb") as file_obj:
                    logfire.info("calling storage.save")
                    file_id = await storage.save(file_obj, filename)
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
                from backend.storage.r2 import R2Storage

                if isinstance(storage, R2Storage):
                    r2_url = await storage.get_url(file_id)

            # save image if provided
            image_id = None
            image_url = None
            if image_path and image_filename:
                upload_tracker.update_status(
                    upload_id, UploadStatus.PROCESSING, "saving image..."
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
                        upload_id, UploadStatus.PROCESSING, "creating atproto record..."
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
                    upload_id, UploadStatus.PROCESSING, "saving track metadata..."
                )
                extra = {}
                if album:
                    extra["album"] = album

                track = Track(
                    title=title,
                    file_id=file_id,
                    file_type=ext[1:],
                    artist_did=artist_did,
                    extra=extra,
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
    """upload a new track (requires authentication and artist profile).

    returns immediately with upload_id for tracking progress via SSE.

    features: optional JSON array of ATProto handles, e.g., ["user1.bsky.social", "user2.bsky.social"]
    image: optional image file for track artwork
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

        # spawn background task (fire-and-forget)
        _task = asyncio.create_task(  # noqa: RUF006
            _process_upload_background(
                upload_id=upload_id,
                file_path=file_path,
                filename=file.filename,
                title=title,
                artist_did=auth_session.did,
                album=album,
                features=features,
                auth_session=auth_session,
                image_path=image_path,
                image_filename=image_filename,
            )
        )
    except Exception:
        # cleanup temp files on error
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
        """generate SSE events for upload progress."""
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


@router.get("/")
async def list_tracks(
    db: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    artist_did: str | None = None,
) -> dict:
    """list all tracks, optionally filtered by artist DID."""
    from atproto_identity.did.resolver import AsyncDidResolver

    # get authenticated user if auth header present
    liked_track_ids: set[int] | None = None
    if (
        session_id := request.headers.get("authorization", "").replace("Bearer ", "")
    ) and (auth_session := await get_session(session_id)):
        liked_result = await db.execute(
            select(TrackLike.track_id).where(TrackLike.user_did == auth_session.did)
        )
        liked_track_ids = set(liked_result.scalars().all())

    stmt = select(Track).join(Artist).options(selectinload(Track.artist))

    # filter by artist if provided
    if artist_did:
        stmt = stmt.where(Track.artist_did == artist_did)

    stmt = stmt.order_by(Track.created_at.desc())
    result = await db.execute(stmt)
    tracks = result.scalars().all()

    # batch fetch like counts for all tracks
    track_ids = [track.id for track in tracks]
    like_counts = await get_like_counts(db, track_ids)

    # use cached PDS URLs with fallback on failure
    resolver = AsyncDidResolver()
    pds_cache = {}

    # first pass: collect already-cached PDS URLs and artists needing resolution
    artists_to_resolve = {}  # dict for O(1) deduplication by DID
    for track in tracks:
        if track.artist_did not in pds_cache:
            if track.artist.pds_url:
                pds_cache[track.artist_did] = track.artist.pds_url
            else:
                # need to resolve this artist
                if track.artist_did not in artists_to_resolve:
                    artists_to_resolve[track.artist_did] = track.artist

    # resolve all uncached PDS URLs concurrently
    if artists_to_resolve:

        async def resolve_artist(artist: Artist) -> tuple[str, str | None]:
            """resolve PDS URL for an artist, returning (did, pds_url)."""
            try:
                atproto_data = await resolver.resolve_atproto_data(artist.did)
                return (artist.did, atproto_data.pds)
            except Exception as e:
                logger.warning(f"failed to resolve PDS for {artist.did}: {e}")
                return (artist.did, None)

        # resolve all concurrently
        results = await asyncio.gather(
            *[resolve_artist(a) for a in artists_to_resolve.values()]
        )

        # update cache and database with O(1) lookups
        for did, pds_url in results:
            pds_cache[did] = pds_url
            if pds_url:
                artist = artists_to_resolve.get(did)
                if artist:
                    artist.pds_url = pds_url
                    db.add(artist)

    # commit any PDS URL updates
    await db.commit()

    # fetch all track responses concurrently with like status and counts
    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                track, pds_cache.get(track.artist_did), liked_track_ids, like_counts
            )
            for track in tracks
        ]
    )

    return {"tracks": track_responses}


@router.get("/me")
async def list_my_tracks(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> dict:
    """list tracks uploaded by authenticated user."""
    stmt = (
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist))
        .where(Track.artist_did == auth_session.did)
        .order_by(Track.created_at.desc())
    )
    result = await db.execute(stmt)
    tracks = result.scalars().all()

    # fetch all track responses concurrently
    track_responses = await asyncio.gather(
        *[TrackResponse.from_track(track) for track in tracks]
    )

    return {"tracks": track_responses}


class BrokenTracksResponse(BaseModel):
    """response for broken tracks endpoint."""

    tracks: list[dict[str, Any]]
    count: int


@router.get("/me/broken")
async def list_broken_tracks(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> BrokenTracksResponse:
    """list tracks owned by authenticated user that have missing ATProto records.

    returns tracks with null atproto_record_uri, indicating they need recovery.
    these tracks cannot be liked and may need migration or recreation.
    """
    stmt = (
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist))
        .where(Track.artist_did == auth_session.did)
        .where((Track.atproto_record_uri.is_(None)) | (Track.atproto_record_uri == ""))
        .order_by(Track.created_at.desc())
    )
    result = await db.execute(stmt)
    tracks = result.scalars().all()

    # fetch all track responses concurrently
    track_responses = await asyncio.gather(
        *[TrackResponse.from_track(track) for track in tracks]
    )

    return BrokenTracksResponse(tracks=track_responses, count=len(track_responses))


@router.delete("/{track_id}")
async def delete_track(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> dict:
    """delete a track (only by owner)."""
    result = await db.execute(select(Track).where(Track.id == track_id))
    track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    # verify ownership
    if track.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403,
            detail="you can only delete your own tracks",
        )

    # delete ATProto record if it exists
    if track.atproto_record_uri:
        from backend._internal.atproto.records import delete_record_by_uri

        try:
            await delete_record_by_uri(auth_session, track.atproto_record_uri)
            logfire.info(
                "deleted ATProto record",
                track_id=track_id,
                record_uri=track.atproto_record_uri,
            )
        except Exception as e:
            # check if it's a 404 (record already gone)
            error_str = str(e).lower()
            if "404" in error_str or "not found" in error_str:
                logfire.info(
                    "ATProto record already deleted",
                    track_id=track_id,
                    record_uri=track.atproto_record_uri,
                )
            else:
                # other errors should bubble up
                logger.error(
                    f"failed to delete ATProto record {track.atproto_record_uri}: {e}",
                    exc_info=True,
                )
                raise HTTPException(
                    status_code=500,
                    detail=f"failed to delete ATProto record: {e}",
                ) from e

    # delete audio file from storage
    try:
        await storage.delete(track.file_id, track.file_type)
    except Exception as e:
        # log but don't fail - maybe file was already deleted
        logger.warning(f"failed to delete file {track.file_id}: {e}", exc_info=True)

    # delete track record
    await db.delete(track)
    await db.commit()

    return {"message": "track deleted successfully"}


@router.patch("/{track_id}")
async def update_track_metadata(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
    title: Annotated[str | None, Form()] = None,
    album: Annotated[str | None, Form()] = None,
    features: Annotated[str | None, Form()] = None,  # JSON array of handles
    image: UploadFile | None = File(None),
) -> dict:
    """update track metadata (only by owner).

    features: optional JSON array of ATProto handles, e.g., ["user1.bsky.social", "user2.bsky.social"]
    image: optional image file for track artwork
    """
    result = await db.execute(
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist))
        .where(Track.id == track_id)
    )
    track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    # verify ownership
    if track.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403,
            detail="you can only edit your own tracks",
        )

    # update fields if provided
    if title is not None:
        track.title = title

    if album is not None:
        if album:
            # set or update album
            if track.extra is None:
                track.extra = {}
            track.extra["album"] = album
            # flag the JSONB field as modified so SQLAlchemy detects the change
            attributes.flag_modified(track, "extra")
        else:
            # remove album if empty string
            if track.extra and "album" in track.extra:
                del track.extra["album"]
                attributes.flag_modified(track, "extra")

    if features is not None:
        # resolve featured artist handles
        featured_artists = []
        try:
            handles_list = json.loads(features)
            if not isinstance(handles_list, list):
                raise HTTPException(
                    status_code=400, detail="features must be a JSON array of handles"
                )

            if len(handles_list) > MAX_FEATURES:
                raise HTTPException(
                    status_code=400,
                    detail=f"maximum {MAX_FEATURES} featured artists allowed",
                )

            # validate all handles first
            valid_handles = []
            for handle in handles_list:
                if not isinstance(handle, str):
                    raise HTTPException(
                        status_code=400, detail="each feature must be a string handle"
                    )

                # prevent self-featuring
                if handle.lstrip("@") == track.artist.handle:
                    continue  # skip self-feature silently

                valid_handles.append(handle)

            # batch resolve all handles concurrently
            if valid_handles:
                resolved_artists = await asyncio.gather(
                    *[resolve_handle(h) for h in valid_handles],
                    return_exceptions=True,
                )

                # check for any failed resolutions
                for handle, resolved in zip(
                    valid_handles, resolved_artists, strict=False
                ):
                    if isinstance(resolved, Exception) or not resolved:
                        raise HTTPException(
                            status_code=400,
                            detail=f"failed to resolve handle: {handle}",
                        )
                    featured_artists.append(resolved)

            track.features = featured_artists

        except json.JSONDecodeError as e:
            raise HTTPException(
                status_code=400, detail=f"invalid JSON in features: {e}"
            ) from e

    # handle image update
    image_url = None
    if image and image.filename:
        _image_format, is_valid = ImageFormat.validate_and_extract(image.filename)
        if not is_valid:
            raise HTTPException(
                status_code=400,
                detail="unsupported image type. supported: jpg, png, webp, gif",
            )

        # read and validate image size
        image_data = await image.read()
        max_image_size = 20 * 1024 * 1024  # 20MB
        if len(image_data) > max_image_size:
            raise HTTPException(
                status_code=413,
                detail="image too large (max 20MB)",
            )
        image_obj = BytesIO(image_data)
        image_id = await storage.save(image_obj, f"images/{image.filename}")

        # get R2 URL for image if using R2 storage
        image_url = None
        if settings.storage.backend == "r2" and isinstance(storage, R2Storage):
            image_url = await storage.get_url(image_id)

        # delete old image if exists
        if track.image_id:
            with contextlib.suppress(Exception):
                await storage.delete(track.image_id)

        track.image_id = image_id
        track.image_url = image_url

    # update ATProto record if any fields changed
    if track.atproto_record_uri and (
        title is not None or album is not None or features is not None or image_url
    ):
        try:
            # build updated record with all current values
            updated_record = build_track_record(
                title=track.title,
                artist=track.artist.display_name,
                audio_url=track.r2_url,
                file_type=track.file_type,
                album=track.album,
                duration=None,
                features=track.features if track.features else None,
                image_url=image_url or await track.get_image_url(),
            )

            # update the record on the PDS
            result = await update_record(
                auth_session=auth_session,
                record_uri=track.atproto_record_uri,
                record=updated_record,
            )

            if result:
                _, new_cid = result
                track.atproto_record_cid = new_cid

        except Exception as e:
            logger.warning(f"failed to update ATProto record: {e}", exc_info=True)
            # continue even if ATProto update fails - database changes are primary

    await db.commit()
    await db.refresh(track)

    return await TrackResponse.from_track(track)


class RestoreRecordResponse(BaseModel):
    """response for restore record endpoint."""

    success: bool
    track: dict[str, Any]
    restored_uri: str


async def _check_old_namespace_records(
    auth_session: AuthSession, track_id: int
) -> bool:
    """check if track has records in old namespace.

    returns True if old namespace records exist (migration needed).
    returns False if no old namespace records found (can recreate).
    logs warnings but doesn't raise on errors (allows recreation to proceed).
    """
    if not settings.atproto.old_app_namespace:
        return False

    old_collection = settings.atproto.old_track_collection
    if not old_collection:
        return False

    try:
        oauth_data = auth_session.oauth_session
        if not oauth_data or "access_token" not in oauth_data:
            raise HTTPException(status_code=401, detail="invalid session")

        oauth_session = _reconstruct_oauth_session(oauth_data)

        url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.listRecords"
        params = {
            "repo": auth_session.did,
            "collection": old_collection,
            "limit": 100,
        }

        # try request with token refresh
        for attempt in range(2):
            response = await oauth_client.make_authenticated_request(
                session=oauth_session,
                method="GET",
                url=url,
                params=params,
            )

            if response.status_code == 200:
                result = response.json()
                records = result.get("records", [])
                return len(records) > 0

            # token expired - refresh and retry
            if response.status_code == 401 and attempt == 0:
                try:
                    error_data = response.json()
                    if "exp" in error_data.get("message", ""):
                        logger.info(
                            f"token expired while checking old namespace for track {track_id}, refreshing"
                        )
                        oauth_session = await _refresh_session_tokens(
                            auth_session, oauth_session
                        )
                        continue
                except Exception as e:
                    logger.warning(
                        f"failed to parse token expiry for track {track_id}: {e}"
                    )
                    break

            # other errors - log and allow recreation to proceed
            logger.warning(
                f"failed to check old namespace for track {track_id}: {response.status_code}"
            )
            return False

        return False

    except HTTPException:
        raise
    except Exception as e:
        logger.warning(
            f"error checking old namespace for track {track_id}: {e}", exc_info=True
        )
        return False


async def _create_atproto_record(
    auth_session: AuthSession,
    track: Track,
    rkey: str,
    track_record: dict,
) -> tuple[str, str]:
    """create ATProto record on PDS.

    returns (uri, cid) tuple on success.
    raises HTTPException on failure.
    """
    oauth_data = auth_session.oauth_session
    if not oauth_data or "access_token" not in oauth_data:
        raise HTTPException(status_code=401, detail="invalid session")

    oauth_session = _reconstruct_oauth_session(oauth_data)

    create_url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.createRecord"
    payload = {
        "repo": auth_session.did,
        "collection": settings.atproto.track_collection,
        "rkey": rkey,
        "record": track_record,
    }

    # try create with token refresh
    for attempt in range(2):
        response = await oauth_client.make_authenticated_request(
            session=oauth_session,
            method="POST",
            url=create_url,
            json=payload,
        )

        if response.status_code == 200:
            result = response.json()
            new_uri = result.get("uri")
            new_cid = result.get("cid")
            if not new_uri or not new_cid:
                raise HTTPException(
                    status_code=500, detail="PDS returned success but missing uri/cid"
                )
            return new_uri, new_cid

        # token expired - refresh and retry
        if response.status_code == 401 and attempt == 0:
            try:
                error_data = response.json()
                if "exp" in error_data.get("message", ""):
                    logger.info(
                        f"token expired while creating record for track {track.id}, refreshing"
                    )
                    oauth_session = await _refresh_session_tokens(
                        auth_session, oauth_session
                    )
                    continue
            except Exception as e:
                logger.warning(
                    f"failed to parse token expiry for track {track.id}: {e}"
                )
                # fall through to error handling

        # creation failed
        error_text = response.text
        logger.error(
            f"failed to create ATProto record for track {track.id}: {response.status_code} {error_text}"
        )
        raise HTTPException(
            status_code=response.status_code,
            detail=f"failed to create ATProto record: {error_text}",
        )

    raise HTTPException(
        status_code=500, detail="failed to create record after token refresh retry"
    )


@router.post("/{track_id}/restore-record")
async def restore_track_record(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> RestoreRecordResponse:
    """restore ATProto record for track with missing record.

    this endpoint handles two cases:
    1. track has record in old namespace → returns 409 migration_needed
    2. track has no record anywhere → recreates with TID from created_at

    returns updated track data on success.
    """
    # fetch and validate track
    result = await db.execute(
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist))
        .where(Track.id == track_id)
    )
    track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    if track.artist_did != auth_session.did:
        raise HTTPException(
            status_code=403,
            detail="you can only restore your own tracks",
        )

    if track.atproto_record_uri:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "already_has_record",
                "message": "track already has an ATProto record",
                "uri": track.atproto_record_uri,
            },
        )

    # check for old namespace records
    has_old_namespace = await _check_old_namespace_records(auth_session, track_id)
    if has_old_namespace:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "migration_needed",
                "message": "track has record in old namespace - use migration instead",
                "old_collection": settings.atproto.old_track_collection,
            },
        )

    # recreate record with TID from created_at
    rkey = datetime_to_tid(track.created_at)

    track_record = build_track_record(
        title=track.title,
        artist=track.artist.display_name,
        audio_url=track.r2_url,
        file_type=track.file_type,
        album=track.album,
        duration=None,
        features=track.features if track.features else None,
        image_url=await track.get_image_url(),
    )
    track_record["createdAt"] = track.created_at.isoformat()

    # create record on PDS
    try:
        new_uri, new_cid = await _create_atproto_record(
            auth_session, track, rkey, track_record
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"unexpected error creating record for track {track_id}: {e}", exc_info=True
        )
        raise HTTPException(status_code=500, detail=str(e)) from e

    # update database
    track.atproto_record_uri = new_uri
    track.atproto_record_cid = new_cid
    await db.commit()
    await db.refresh(track)

    logger.info(f"restored ATProto record for track {track_id}: {new_uri}")

    return RestoreRecordResponse(
        success=True,
        track=await TrackResponse.from_track(track),
        restored_uri=new_uri,
    )


@router.get("/liked")
async def list_liked_tracks(
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> dict:
    """list tracks liked by authenticated user (queried from local index)."""
    stmt = (
        select(Track)
        .join(TrackLike, TrackLike.track_id == Track.id)
        .join(Artist)
        .options(selectinload(Track.artist))
        .where(TrackLike.user_did == auth_session.did)
        .order_by(TrackLike.created_at.desc())
    )

    result = await db.execute(stmt)
    tracks = result.scalars().all()

    # all tracks in this endpoint are liked by definition - build set of track IDs
    liked_track_ids = {track.id for track in tracks}

    # batch fetch like counts for all tracks
    track_ids = [track.id for track in tracks]
    like_counts = await get_like_counts(db, track_ids)

    track_responses = await asyncio.gather(
        *[
            TrackResponse.from_track(
                track, liked_track_ids=liked_track_ids, like_counts=like_counts
            )
            for track in tracks
        ]
    )

    return {"tracks": track_responses}


@router.get("/{track_id}")
async def get_track(
    track_id: int, db: Annotated[AsyncSession, Depends(get_db)], request: Request
) -> dict:
    """get a specific track."""
    # get authenticated user if auth header present
    liked_track_ids: set[int] | None = None
    if (
        (session_id := request.headers.get("authorization", "").replace("Bearer ", ""))
        and (auth_session := await get_session(session_id))
        and await db.scalar(
            select(TrackLike.track_id).where(
                TrackLike.user_did == auth_session.did, TrackLike.track_id == track_id
            )
        )
    ):
        liked_track_ids = {track_id}

    result = await db.execute(
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist))
        .where(Track.id == track_id)
    )
    track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    # get like count for this track
    like_counts = await get_like_counts(db, [track_id])

    return await TrackResponse.from_track(
        track, liked_track_ids=liked_track_ids, like_counts=like_counts
    )


@router.post("/{track_id}/play")
async def increment_play_count(
    track_id: int, db: Annotated[AsyncSession, Depends(get_db)]
) -> dict:
    """increment play count for a track (called after 30 seconds of playback)."""
    result = await db.execute(select(Track).where(Track.id == track_id))
    track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    # atomic increment using ORM
    track.play_count += 1
    await db.commit()
    await db.refresh(track)

    return {"play_count": track.play_count}


@router.post("/{track_id}/like")
async def like_track(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> dict:
    """like a track - creates ATProto record and indexes it locally."""
    # verify track exists and has ATProto record
    result = await db.execute(select(Track).where(Track.id == track_id))
    track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    if not track.atproto_record_uri:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "missing_atproto_record",
                "message": "this track cannot be liked because its ATProto record is missing",
            },
        )

    # check if already liked
    existing = await db.execute(
        select(TrackLike).where(
            TrackLike.track_id == track_id, TrackLike.user_did == auth_session.did
        )
    )
    if existing.scalar_one_or_none():
        return {"liked": True}

    # create ATProto like record on user's PDS
    like_uri = await create_like_record(
        auth_session=auth_session,
        subject_uri=track.atproto_record_uri,
        subject_cid=track.atproto_record_cid,
    )

    # index the like in our database
    like = TrackLike(
        track_id=track_id,
        user_did=auth_session.did,
        atproto_like_uri=like_uri,
    )

    db.add(like)
    try:
        await db.commit()
    except Exception as e:
        logger.error(
            f"failed to commit like to database after creating ATProto record: {e}"
        )
        # attempt to clean up orphaned ATProto like record
        try:
            await delete_record_by_uri(
                auth_session=auth_session,
                record_uri=like_uri,
            )
            logger.info(f"cleaned up orphaned ATProto like record: {like_uri}")
        except Exception as cleanup_exc:
            logger.error(
                f"failed to clean up orphaned ATProto like record {like_uri}: {cleanup_exc}"
            )
        raise HTTPException(
            status_code=500, detail="failed to like track - please try again"
        ) from e

    return {"liked": True, "atproto_uri": like_uri}


@router.delete("/{track_id}/like")
async def unlike_track(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> dict:
    """unlike a track - deletes ATProto record and removes from index."""
    # find existing like
    result = await db.execute(
        select(TrackLike).where(
            TrackLike.track_id == track_id, TrackLike.user_did == auth_session.did
        )
    )
    like = result.scalar_one_or_none()

    if not like:
        return {"liked": False}

    # get track info in case we need to rollback
    track_result = await db.execute(select(Track).where(Track.id == track_id))
    track = track_result.scalar_one_or_none()
    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    if not track.atproto_record_uri or not track.atproto_record_cid:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "missing_atproto_record",
                "message": "this track cannot be unliked because its ATProto record is missing",
            },
        )

    # delete ATProto like record from user's PDS
    await delete_record_by_uri(
        auth_session=auth_session,
        record_uri=like.atproto_like_uri,
    )

    # remove from our index
    await db.delete(like)
    try:
        await db.commit()
    except Exception as e:
        logger.error(
            f"failed to commit unlike to database after deleting ATProto record: {e}"
        )
        # attempt to recreate the ATProto like record to maintain consistency
        try:
            recreated_uri = await create_like_record(
                auth_session=auth_session,
                subject_uri=track.atproto_record_uri,
                subject_cid=track.atproto_record_cid,
            )
            logger.info(
                f"rolled back ATProto deletion by recreating like: {recreated_uri}"
            )
        except Exception as rollback_exc:
            logger.critical(
                f"failed to rollback ATProto deletion for track {track_id}, "
                f"user {auth_session.did}: {rollback_exc}. "
                "database and ATProto are now inconsistent"
            )
        raise HTTPException(
            status_code=500, detail="failed to unlike track - please try again"
        ) from e

    return {"liked": False}
