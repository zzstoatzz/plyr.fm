"""Track mutation endpoints (delete/update/restore)."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from io import BytesIO
from typing import Annotated

import logfire
from fastapi import Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import attributes, selectinload

from backend._internal import Session as AuthSession
from backend._internal import oauth_client, require_auth
from backend._internal.atproto import delete_record_by_uri
from backend._internal.atproto.handles import resolve_handle
from backend._internal.atproto.records import (
    _reconstruct_oauth_session,
    _refresh_session_tokens,
    build_track_record,
    update_record,
)
from backend._internal.atproto.tid import datetime_to_tid
from backend._internal.image import ImageFormat
from backend.config import settings
from backend.models import Artist, Track, get_db
from backend.schemas import TrackResponse
from backend.storage import storage
from backend.storage.r2 import R2Storage

from .constants import MAX_FEATURES
from .router import router
from .services import get_or_create_album

logger = logging.getLogger(__name__)


@router.delete("/{track_id}")
async def delete_track(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> dict:
    """Delete a track (only by owner)."""
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

    # update fields if provided
    if title is not None:
        track.title = title

    if album is not None:
        if album:
            if track.extra is None:
                track.extra = {}
            track.extra["album"] = album
            attributes.flag_modified(track, "extra")
            album_record = await get_or_create_album(
                db,
                track.artist,
                album,
                track.image_id,
                track.image_url,
            )
            track.album_id = album_record.id
        else:
            if track.extra and "album" in track.extra:
                del track.extra["album"]
                attributes.flag_modified(track, "extra")
            track.album_id = None

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
    """Response for restore record endpoint."""

    success: bool
    track: TrackResponse
    restored_uri: str


def _get_oauth_session(auth_session: AuthSession):
    oauth_data = auth_session.oauth_session
    if not oauth_data or "access_token" not in oauth_data:
        raise HTTPException(status_code=401, detail="invalid session")
    return oauth_data, _reconstruct_oauth_session(oauth_data)


async def _check_old_namespace_records(
    auth_session: AuthSession, track_id: int
) -> bool:
    """Check if track has records in old namespace."""
    if not settings.atproto.old_app_namespace:
        return False

    old_collection = settings.atproto.old_track_collection
    if not old_collection:
        return False

    oauth_data, oauth_session = _get_oauth_session(auth_session)

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


async def _create_atproto_record(
    auth_session: AuthSession,
    track: Track,
    rkey: str,
    track_record: dict,
) -> tuple[str, str]:
    """Create an ATProto record for the track."""
    oauth_data, oauth_session = _get_oauth_session(auth_session)

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
    """Restore ATProto record for track with missing record."""
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
