"""Track mutation endpoints (delete/update/restore)."""

import contextlib
import logging
from typing import Annotated

import logfire
from fastapi import Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import require_auth
from backend._internal.atproto import delete_record_by_uri
from backend._internal.atproto.records import (
    _make_pds_query,
    _make_pds_request,
    build_track_record,
    update_record,
)
from backend._internal.atproto.tid import datetime_to_tid
from backend.config import settings
from backend.models import Artist, Track, get_db
from backend.schemas import TrackResponse
from backend.storage import storage

from .metadata_service import (
    apply_album_update,
    resolve_feature_handles,
    upload_track_image,
)
from .router import router

logger = logging.getLogger(__name__)


@router.delete("/{track_id}")
async def delete_track(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> dict:
    """Delete a track (only by owner)."""
    result = await db.execute(
        select(Track).options(selectinload(Track.album_rel)).where(Track.id == track_id)
    )
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

    # delete image file from storage (if album doesn't share it)
    if track.image_id:
        album_shares_image = (
            track.album_rel and track.album_rel.image_id == track.image_id
        )
        if not album_shares_image:
            try:
                await storage.delete(track.image_id)
            except Exception as e:
                logger.warning(
                    f"failed to delete image {track.image_id}: {e}", exc_info=True
                )

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
    features: Annotated[str | None, Form()] = None,
    image: UploadFile | None = File(None),
) -> TrackResponse:
    """Update track metadata (only by owner)."""
    result = await db.execute(
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
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

    title_changed = False
    if title is not None:
        track.title = title
        title_changed = True

    await apply_album_update(db, track, album)

    if features is not None:
        track.features = await resolve_feature_handles(
            features, artist_handle=track.artist.handle
        )

    image_changed = False
    image_url = None
    if image and image.filename:
        image_id, image_url = await upload_track_image(image)

        if track.image_id:
            # only delete old image from R2 if album doesn't share it
            # (albums inherit track's image_id on creation, so they may reference the same file)
            album_shares_image = (
                track.album_rel and track.album_rel.image_id == track.image_id
            )
            if not album_shares_image:
                with contextlib.suppress(Exception):
                    await storage.delete(track.image_id)

        track.image_id = image_id
        track.image_url = image_url
        image_changed = True

    # always update ATProto record if any metadata changed
    metadata_changed = (
        title_changed or album is not None or features is not None or image_changed
    )
    if track.atproto_record_uri and metadata_changed:
        try:
            await _update_atproto_record(track, auth_session, image_url)
        except Exception as exc:
            logger.error(
                f"failed to update ATProto record for track {track.id}: {exc}",
                exc_info=True,
            )
            await db.rollback()
            raise HTTPException(
                status_code=500,
                detail=f"failed to sync track update to ATProto: {exc!s}",
            ) from exc

    await db.commit()
    await db.refresh(track)

    return await TrackResponse.from_track(track)


async def _update_atproto_record(
    track: Track,
    auth_session: AuthSession,
    image_url_override: str | None = None,
) -> None:
    """Update the ATProto record for a track.

    raises:
        Exception: if ATProto record update fails
    """
    record_uri = track.atproto_record_uri
    audio_url = track.r2_url
    if not record_uri or not audio_url:
        return

    updated_record = build_track_record(
        title=track.title,
        artist=track.artist.display_name,
        audio_url=audio_url,
        file_type=track.file_type,
        album=track.album,
        duration=None,
        features=track.features if track.features else None,
        image_url=image_url_override or await track.get_image_url(),
    )

    result = await update_record(
        auth_session=auth_session,
        record_uri=record_uri,
        record=updated_record,
    )

    if result:
        _, new_cid = result
        track.atproto_record_cid = new_cid


class RestoreRecordResponse(BaseModel):
    """Response for restore record endpoint."""

    success: bool
    track: TrackResponse
    restored_uri: str


async def _check_old_namespace_records(
    auth_session: AuthSession, track_id: int
) -> bool:
    """Check if track has records in old namespace."""
    if not settings.atproto.old_app_namespace:
        return False

    old_collection = settings.atproto.old_track_collection
    if not old_collection:
        return False

    try:
        result = await _make_pds_query(
            auth_session,
            "com.atproto.repo.listRecords",
            {
                "repo": auth_session.did,
                "collection": old_collection,
                "limit": 100,
            },
        )
        records = result.get("records", [])
        return len(records) > 0
    except Exception as e:
        logger.warning(f"failed to check old namespace for track {track_id}: {e}")
        return False


async def _create_atproto_record(
    auth_session: AuthSession,
    track: Track,
    rkey: str,
    track_record: dict,
) -> tuple[str, str]:
    """Create an ATProto record for the track."""
    payload = {
        "repo": auth_session.did,
        "collection": settings.atproto.track_collection,
        "rkey": rkey,
        "record": track_record,
    }

    try:
        result = await _make_pds_request(
            auth_session,
            "POST",
            "com.atproto.repo.createRecord",
            payload,
        )
        new_uri = result.get("uri")
        new_cid = result.get("cid")
        if not new_uri or not new_cid:
            raise HTTPException(
                status_code=500, detail="PDS returned success but missing uri/cid"
            )
        return new_uri, new_cid
    except Exception as e:
        logger.error(f"failed to create ATProto record for track {track.id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"failed to create ATProto record: {e}",
        ) from e


@router.post("/{track_id}/restore-record")
async def restore_track_record(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> RestoreRecordResponse:
    """Restore ATProto record for a track with a missing record.

    Handles two cases:
    1. If the track has a record in the old namespace, respond with 409
       (`migration_needed`).
    2. If no record exists, recreate one using a TID derived from
       `track.created_at` and return the updated track data on success.
    """
    # fetch and validate track
    result = await db.execute(
        select(Track)
        .join(Artist)
        .options(selectinload(Track.artist), selectinload(Track.album_rel))
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

    # validate track has R2 URL (required for ATProto records)
    if not track.r2_url:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "no_public_url",
                "message": "cannot restore ATProto record without R2 URL (local storage tracks are not supported)",
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
