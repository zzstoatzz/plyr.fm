"""Track mutation endpoints (delete/update/restore)."""

import contextlib
import json
import logging
from datetime import UTC, datetime
from typing import Annotated
from urllib.parse import urljoin

import logfire
from fastapi import Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import get_oauth_client, require_auth
from backend._internal.atproto import delete_record_by_uri
from backend._internal.atproto.records import (
    _reconstruct_oauth_session,
    _refresh_session_tokens,
    build_track_record,
    update_record,
)
from backend._internal.atproto.tid import datetime_to_tid
from backend._internal.background_tasks import (
    schedule_album_list_sync,
    schedule_move_track_audio,
)
from backend.config import settings
from backend.models import Artist, Tag, Track, TrackTag, get_db
from backend.schemas import TrackResponse
from backend.storage import storage
from backend.utilities.tags import parse_tags_json

from .metadata_service import (
    apply_album_update,
    resolve_feature_handles,
    upload_track_image,
)
from .router import router

logger = logging.getLogger(__name__)


async def _get_or_create_tag(db: AsyncSession, tag_name: str, creator_did: str) -> Tag:
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

    # capture album_id before deletion for list sync
    album_id_to_sync = track.album_id

    # delete track record
    await db.delete(track)
    await db.commit()

    # sync album list record if track was in an album
    if album_id_to_sync:
        await schedule_album_list_sync(auth_session.session_id, album_id_to_sync)

    return {"message": "track deleted successfully"}


@router.patch("/{track_id}")
async def update_track_metadata(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
    title: Annotated[str | None, Form()] = None,
    album: Annotated[str | None, Form()] = None,
    features: Annotated[str | None, Form()] = None,
    tags: Annotated[str | None, Form(description="JSON array of tag names")] = None,
    support_gate: Annotated[
        str | None,
        Form(description="JSON object for supporter gating, or 'null' to remove"),
    ] = None,
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

    # handle support_gate update
    # track migration direction: None = no move, True = to private, False = to public
    move_to_private: bool | None = None
    if support_gate is not None:
        was_gated = track.support_gate is not None
        if support_gate.lower() == "null" or support_gate == "":
            # removing gating - need to move file back to public if it was gated
            if was_gated and track.r2_url is None:
                move_to_private = False
            track.support_gate = None
        else:
            try:
                parsed_gate = json.loads(support_gate)
                if not isinstance(parsed_gate, dict):
                    raise ValueError("support_gate must be a JSON object")
                if "type" not in parsed_gate:
                    raise ValueError("support_gate must have a 'type' field")
                if parsed_gate["type"] not in ("any",):
                    raise ValueError(
                        f"unsupported support_gate type: {parsed_gate['type']}"
                    )
                # enabling gating - need to move file to private if it was public
                if not was_gated and track.r2_url is not None:
                    move_to_private = True
                track.support_gate = parsed_gate
            except json.JSONDecodeError as e:
                raise HTTPException(
                    status_code=400, detail=f"invalid support_gate JSON: {e}"
                ) from e
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e

    # track album changes for list sync
    old_album_id = track.album_id
    await apply_album_update(db, track, album)
    new_album_id = track.album_id
    album_changed = old_album_id != new_album_id

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

    # handle tags update
    updated_tags: set[str] = set()
    if tags is not None:
        try:
            validated_tags = parse_tags_json(tags)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        # delete existing track_tags for this track
        existing_track_tags = await db.execute(
            select(TrackTag).where(TrackTag.track_id == track_id)
        )
        for tt in existing_track_tags.scalars():
            await db.delete(tt)

        # get or create tags and create track_tags
        for tag_name in validated_tags:
            # get or create tag with race condition handling
            tag = await _get_or_create_tag(db, tag_name, auth_session.did)

            # create track_tag association
            track_tag = TrackTag(track_id=track_id, tag_id=tag.id)
            db.add(track_tag)
            updated_tags.add(tag_name)

    # always update ATProto record if any metadata changed
    support_gate_changed = move_to_private is not None
    metadata_changed = (
        title_changed
        or album is not None
        or features is not None
        or image_changed
        or support_gate_changed
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

    # sync album list records if album changed
    if album_changed:
        # sync old album (track was removed)
        if old_album_id:
            await schedule_album_list_sync(auth_session.session_id, old_album_id)
        # sync new album (track was added)
        if new_album_id:
            await schedule_album_list_sync(auth_session.session_id, new_album_id)

    # move audio file between buckets if support_gate was toggled
    if move_to_private is not None:
        await schedule_move_track_audio(track.id, to_private=move_to_private)

    # build track_tags dict for response
    # if tags were updated, use updated_tags; otherwise query for existing
    if tags is not None:
        track_tags_dict = {track.id: updated_tags}
    else:
        from backend.utilities.aggregations import get_track_tags

        track_tags_dict = await get_track_tags(db, [track.id])

    return await TrackResponse.from_track(track, track_tags=track_tags_dict)


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
    if not record_uri:
        return

    # for gated tracks, use the API endpoint URL instead of r2_url
    # (r2_url is None for private bucket tracks)
    if track.support_gate is not None:
        backend_url = settings.atproto.redirect_uri.rsplit("/", 2)[0]
        audio_url = urljoin(backend_url + "/", f"audio/{track.file_id}")
    else:
        audio_url = track.r2_url
        if not audio_url:
            return

    updated_record = build_track_record(
        title=track.title,
        artist=track.artist.display_name,
        audio_url=audio_url,
        file_type=track.file_type,
        album=track.album,
        duration=track.duration,
        features=track.features if track.features else None,
        image_url=image_url_override or await track.get_image_url(),
        support_gate=track.support_gate,
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
        response = await get_oauth_client().make_authenticated_request(
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
        "collection": settings.atproto.effective_track_collection,
        "rkey": rkey,
        "record": track_record,
    }

    # try create with token refresh
    for attempt in range(2):
        response = await get_oauth_client().make_authenticated_request(
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
        duration=track.duration,
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

    # sync album list if track is in an album
    if track.album_id:
        await schedule_album_list_sync(auth_session.session_id, track.album_id)

    logger.info(f"restored ATProto record for track {track_id}: {new_uri}")

    return RestoreRecordResponse(
        success=True,
        track=await TrackResponse.from_track(track),
        restored_uri=new_uri,
    )
