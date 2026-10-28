"""account management endpoints."""

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend._internal.account_media import capture_account_media
from backend._internal.atproto import delete_record_by_uri
from backend._internal.atproto.client import parse_at_uri
from backend._internal.atproto.spaces.client import delete_space_record
from backend._internal.atproto.spaces.uris import (
    parse_space_record_uri,
    parse_space_uri,
)
from backend._internal.auth.session import _invalidate_session_cache
from backend.config import settings
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
from backend.utilities.tags import DEFAULT_HIDDEN_TAGS

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

    tracks = list(
        await db.scalars(select(Track).where(Track.artist_did == session.did))
    )
    media = await capture_account_media(db, tracks, session.did)
    track_ids = [track.id for track in tracks]

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
    session_ids_result = await db.execute(
        select(UserSession.session_id).where(UserSession.did == session.did)
    )
    session_ids_to_invalidate = [sid for (sid,) in session_ids_result.fetchall()]
    await db.execute(delete(UserSession).where(UserSession.did == session.did))

    await db.commit()

    for sid in session_ids_to_invalidate:
        await _invalidate_session_cache(sid)

    deleted_counts["r2_objects"] = await media.delete_copies()

    # delete ATProto records if requested
    if request.delete_atproto_records and atproto_uris:
        for uri in atproto_uris:
            try:
                if "/space/" in uri:
                    record = parse_space_record_uri(uri)
                    space = parse_space_uri(record.space)
                    if (
                        record.author_did != session.did
                        or space.owner_did != session.did
                        or space.skey != "self"
                        or space.space_type != settings.atproto.private_media_space_type
                        or record.collection != settings.atproto.track_collection
                    ):
                        raise ValueError("account does not own Space record")
                    await delete_space_record(session, uri)
                else:
                    if parse_at_uri(uri)[0] != session.did:
                        raise ValueError("account does not own public record")
                    await delete_record_by_uri(session, uri)
                deleted_counts["atproto_records"] += 1
            except Exception as e:
                logger.warning(f"failed to delete ATProto record {uri}: {e}")

    if request.delete_atproto_records:
        deleted_counts["atproto_records"] += await media.delete_sources(session)

    logger.info(
        f"account deleted: {session.handle} ({session.did})",
        extra={"deleted": deleted_counts},
    )

    return AccountDeleteResponse(deleted=deleted_counts)


class TermsAcceptanceResponse(BaseModel):
    """response after accepting terms."""

    terms_accepted_at: datetime


@router.post("/accept-terms")
async def accept_terms(
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> TermsAcceptanceResponse:
    """accept terms of service. records timestamp of acceptance."""
    result = await db.execute(
        select(UserPreferences).where(UserPreferences.did == session.did)
    )
    prefs = result.scalar_one_or_none()

    now = datetime.now(UTC)

    if not prefs:
        # create preferences with terms accepted
        prefs = UserPreferences(
            did=session.did,
            accent_color="#6a9fff",
            hidden_tags=list(DEFAULT_HIDDEN_TAGS),
            terms_accepted_at=now,
        )
        db.add(prefs)
    else:
        prefs.terms_accepted_at = now

    await db.commit()

    return TermsAcceptanceResponse(terms_accepted_at=now)
