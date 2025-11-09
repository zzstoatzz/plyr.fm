"""tracks api endpoints."""

import asyncio
import contextlib
import json
import logging
from io import BytesIO
from pathlib import Path
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
)
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import require_artist_profile, require_auth
from backend._internal.uploads import UploadStatus, upload_tracker
from backend.atproto import create_track_record
from backend.atproto.handles import resolve_handle
from backend.atproto.records import build_track_record, update_record
from backend.config import settings
from backend.models import Artist, AudioFormat, Track, get_db
from backend.models.image import ImageFormat
from backend.storage import storage
from backend.storage.r2 import R2Storage
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tracks", tags=["tracks"])


class TrackResponse(dict):
    """track response schema."""

    @classmethod
    def from_track(cls, track: Track, pds_url: str | None = None) -> "TrackResponse":
        """build track response from Track model."""
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
            image_url=track.image_url,
        )


# max featured artists per track
MAX_FEATURES = 5


async def _process_upload_background(
    upload_id: str,
    file_data: bytes,
    filename: str,
    title: str,
    artist_did: str,
    album: str | None,
    features: str | None,
    auth_session: AuthSession,
    image_data: bytes | None = None,
    image_filename: str | None = None,
) -> None:
    """background task to process upload."""
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
            file_obj = BytesIO(file_data)
            file_id = storage.save(file_obj, filename)
        except ValueError as e:
            upload_tracker.update_status(
                upload_id, UploadStatus.FAILED, "upload failed", error=str(e)
            )
            return

        # get R2 URL
        r2_url = None
        if settings.storage.backend == "r2":
            from backend.storage.r2 import R2Storage

            if isinstance(storage, R2Storage):
                r2_url = storage.get_url(file_id)

        # save image if provided
        image_id = None
        image_url = None
        if image_data and image_filename:
            upload_tracker.update_status(
                upload_id, UploadStatus.PROCESSING, "saving image..."
            )
            image_format = ImageFormat.from_filename(image_filename)
            if image_format:
                try:
                    image_obj = BytesIO(image_data)
                    # save with images/ prefix to namespace it
                    image_id = storage.save(image_obj, f"images/{image_filename}")
                    # get R2 URL for image if using R2 storage
                    if settings.storage.backend == "r2" and isinstance(
                        storage, R2Storage
                    ):
                        image_url = storage.get_url(image_id)
                except Exception as e:
                    logger.warning(f"failed to save image: {e}", exc_info=True)
                    # continue without image - it's optional
            else:
                logger.warning(f"unsupported image format: {image_filename}")

        # get artist and resolve features
        async with db_session() as db:
            result = await db.execute(select(Artist).where(Artist.did == artist_did))
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
                    upload_id, UploadStatus.PROCESSING, "resolving featured artists..."
                )
                try:
                    handles_list = json.loads(features)
                    if isinstance(handles_list, list):
                        for handle in handles_list:
                            if (
                                isinstance(handle, str)
                                and handle.lstrip("@") != artist.handle
                            ):
                                resolved = await resolve_handle(handle)
                                if resolved:
                                    featured_artists.append(resolved)
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
                    storage.delete(file_id)

    except Exception as e:
        logger.exception(f"upload {upload_id} failed with unexpected error")
        upload_tracker.update_status(
            upload_id,
            UploadStatus.FAILED,
            "upload failed",
            error=f"unexpected error: {e!s}",
        )


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

    # read file into memory (so FastAPI can close the upload)
    file_data = await file.read()

    # read image if provided
    image_data = None
    image_filename = None
    if image and image.filename:
        image_data = await image.read()
        image_filename = image.filename

    # create upload tracking
    upload_id = upload_tracker.create_upload()

    # spawn background task (fire-and-forget)
    _task = asyncio.create_task(  # noqa: RUF006
        _process_upload_background(
            upload_id=upload_id,
            file_data=file_data,
            filename=file.filename,
            title=title,
            artist_did=auth_session.did,
            album=album,
            features=features,
            auth_session=auth_session,
            image_data=image_data,
            image_filename=image_filename,
        )
    )

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
    artist_did: str | None = None,
) -> dict:
    """list all tracks, optionally filtered by artist DID."""
    from atproto_identity.did.resolver import AsyncDidResolver

    stmt = select(Track).join(Artist).options(selectinload(Track.artist))

    # filter by artist if provided
    if artist_did:
        stmt = stmt.where(Track.artist_did == artist_did)

    stmt = stmt.order_by(Track.created_at.desc())
    result = await db.execute(stmt)
    tracks = result.scalars().all()

    # resolve PDS URLs for each unique artist DID
    resolver = AsyncDidResolver()
    pds_cache = {}

    for track in tracks:
        if track.artist_did not in pds_cache:
            try:
                atproto_data = await resolver.resolve_atproto_data(track.artist_did)
                pds_cache[track.artist_did] = atproto_data.pds
            except Exception as e:
                logger.warning(f"failed to resolve PDS for {track.artist_did}: {e}")
                pds_cache[track.artist_did] = None

    return {
        "tracks": [
            TrackResponse.from_track(track, pds_cache.get(track.artist_did))
            for track in tracks
        ]
    }


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

    return {"tracks": [TrackResponse.from_track(track) for track in tracks]}


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

    # delete audio file from storage
    try:
        storage.delete(track.file_id)
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
        else:
            # remove album if empty string
            if track.extra and "album" in track.extra:
                del track.extra["album"]

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

            # resolve each handle
            for handle in handles_list:
                if not isinstance(handle, str):
                    raise HTTPException(
                        status_code=400, detail="each feature must be a string handle"
                    )

                # prevent self-featuring
                if handle.lstrip("@") == track.artist.handle:
                    continue  # skip self-feature silently

                resolved = await resolve_handle(handle)
                if not resolved:
                    raise HTTPException(
                        status_code=400, detail=f"failed to resolve handle: {handle}"
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
        image_format = ImageFormat.from_filename(image.filename)
        if not image_format:
            raise HTTPException(
                status_code=400,
                detail="unsupported image type. supported: jpg, png, webp, gif",
            )

        # read and save image
        image_data = await image.read()
        image_obj = BytesIO(image_data)
        image_id = storage.save(image_obj, f"images/{image.filename}")

        # get R2 URL for image if using R2 storage
        if settings.storage.backend == "r2" and isinstance(storage, R2Storage):
            image_url = storage.get_url(image_id)

        # delete old image if exists
        if track.image_id:
            with contextlib.suppress(Exception):
                storage.delete(track.image_id)

        track.image_id = image_id

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
                image_url=image_url or track.image_url,
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

    return TrackResponse.from_track(track)


@router.get("/{track_id}")
async def get_track(
    track_id: int, db: Annotated[AsyncSession, Depends(get_db)]
) -> dict:
    """get a specific track."""
    result = await db.execute(
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist))
        .where(Track.id == track_id)
    )
    track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")

    return TrackResponse.from_track(track)


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
