"""account management endpoints."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.atproto import delete_record_by_uri
from backend.models import (
    Album,
    Job,
    QueueState,
    Track,
    TrackComment,
    TrackLike,
    UserPreferences,
    UserSession,
    get_db,
)
from backend.storage import storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/account", tags=["account"])


class AccountDeleteRequest(BaseModel):
    """request body for account deletion."""

    confirmation: str
    delete_atproto_records: bool = False


class AccountDeleteResponse(BaseModel):
    """response body for account deletion."""

    deleted: dict[str, int]


@router.delete("/")
async def delete_account(
    request: AccountDeleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> AccountDeleteResponse:
    """permanently delete user account and all associated data.

    this deletes:
    - all tracks (audio files and cover images from R2)
    - all albums (cover images from R2)
    - all likes given by the user
    - all comments made by the user
    - user preferences
    - all sessions
    - queue state
    - jobs

    optionally deletes ATProto records from user's PDS if requested.
    """
    # verify confirmation matches user's handle
    if request.confirmation != session.handle:
        raise HTTPException(
            status_code=400,
            detail=f"confirmation must match your handle: {session.handle}",
        )

    deleted_counts: dict[str, int] = {
        "tracks": 0,
        "albums": 0,
        "likes": 0,
        "comments": 0,
        "r2_objects": 0,
        "atproto_records": 0,
    }

    # collect ATProto URIs before deleting database records
    atproto_uris: list[str] = []

    if request.delete_atproto_records:
        # track record URIs
        tracks_result = await db.execute(
            select(Track.atproto_record_uri).where(
                Track.artist_did == session.did,
                Track.atproto_record_uri.isnot(None),
            )
        )
        atproto_uris.extend(uri for (uri,) in tracks_result.fetchall())

        # like record URIs (likes given by user)
        likes_result = await db.execute(
            select(TrackLike.atproto_like_uri).where(TrackLike.user_did == session.did)
        )
        atproto_uris.extend(uri for (uri,) in likes_result.fetchall())

        # comment record URIs (comments made by user)
        comments_result = await db.execute(
            select(TrackComment.atproto_comment_uri).where(
                TrackComment.user_did == session.did
            )
        )
        atproto_uris.extend(uri for (uri,) in comments_result.fetchall())

    # collect R2 file IDs before deleting database records
    r2_audio_files: list[tuple[str, str]] = []  # (file_id, file_type)
    r2_image_ids: list[str] = []

    # track audio and images
    tracks_result = await db.execute(
        select(Track.file_id, Track.file_type, Track.image_id).where(
            Track.artist_did == session.did
        )
    )
    for file_id, file_type, image_id in tracks_result.fetchall():
        r2_audio_files.append((file_id, file_type))
        if image_id:
            r2_image_ids.append(image_id)

    # album images
    albums_result = await db.execute(
        select(Album.image_id).where(
            Album.artist_did == session.did, Album.image_id.isnot(None)
        )
    )
    r2_image_ids.extend(image_id for (image_id,) in albums_result.fetchall())

    # get track IDs for cascade deletion of likes/comments received
    track_ids_result = await db.execute(
        select(Track.id).where(Track.artist_did == session.did)
    )
    track_ids = [tid for (tid,) in track_ids_result.fetchall()]

    # delete database records in dependency order

    # 1. delete comments made by user (on any track)
    result = await db.execute(
        delete(TrackComment).where(TrackComment.user_did == session.did)
    )
    deleted_counts["comments"] = result.rowcount or 0  # type: ignore[union-attr]

    # 2. delete likes given by user (on any track)
    result = await db.execute(
        delete(TrackLike).where(TrackLike.user_did == session.did)
    )
    deleted_counts["likes"] = result.rowcount or 0  # type: ignore[union-attr]

    # 3. delete comments ON user's tracks (from other users)
    # these are cascade deleted when tracks are deleted, but explicit is clearer
    if track_ids:
        await db.execute(
            delete(TrackComment).where(TrackComment.track_id.in_(track_ids))
        )

    # 4. delete likes ON user's tracks (from other users)
    if track_ids:
        await db.execute(delete(TrackLike).where(TrackLike.track_id.in_(track_ids)))

    # 5. delete tracks
    result = await db.execute(delete(Track).where(Track.artist_did == session.did))
    deleted_counts["tracks"] = result.rowcount or 0  # type: ignore[union-attr]

    # 6. delete albums
    result = await db.execute(delete(Album).where(Album.artist_did == session.did))
    deleted_counts["albums"] = result.rowcount or 0  # type: ignore[union-attr]

    # 7. delete queue state
    await db.execute(delete(QueueState).where(QueueState.did == session.did))

    # 8. delete preferences
    await db.execute(delete(UserPreferences).where(UserPreferences.did == session.did))

    # 9. delete jobs
    await db.execute(delete(Job).where(Job.owner_did == session.did))

    # 10. delete all sessions (will log user out)
    await db.execute(delete(UserSession).where(UserSession.did == session.did))

    await db.commit()

    # delete R2 objects (after database commit so refcount is 0)
    for file_id, file_type in r2_audio_files:
        try:
            if await storage.delete(file_id, file_type=file_type):
                deleted_counts["r2_objects"] += 1
        except Exception as e:
            logger.warning(f"failed to delete audio {file_id}: {e}")

    for image_id in r2_image_ids:
        try:
            if await storage.delete(image_id):
                deleted_counts["r2_objects"] += 1
        except Exception as e:
            logger.warning(f"failed to delete image {image_id}: {e}")

    # delete ATProto records if requested
    if request.delete_atproto_records and atproto_uris:
        for uri in atproto_uris:
            try:
                await delete_record_by_uri(session, uri)
                deleted_counts["atproto_records"] += 1
            except Exception as e:
                logger.warning(f"failed to delete ATProto record {uri}: {e}")

    logger.info(
        f"account deleted: {session.handle} ({session.did})",
        extra={"deleted": deleted_counts},
    )

    return AccountDeleteResponse(deleted=deleted_counts)
