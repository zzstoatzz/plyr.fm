"""PDS record write background tasks (likes, comments)."""

import logging
from datetime import UTC, datetime

import logfire
from sqlalchemy import select

from backend._internal.atproto.records import (
    create_comment_record,
    create_like_record,
    delete_record_by_uri,
    update_comment_record,
)
from backend._internal.auth import get_session
from backend._internal.background import get_docket
from backend.models import TrackComment, TrackLike
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


async def pds_create_like(
    session_id: str,
    like_id: int,
    subject_uri: str,
    subject_cid: str,
) -> None:
    """create a like record on the user's PDS and update the database.

    args:
        session_id: the user's session ID for authentication
        like_id: database ID of the TrackLike record to update
        subject_uri: AT URI of the track being liked
        subject_cid: CID of the track being liked
    """
    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"pds_create_like: session {session_id[:8]}... not found")
        return

    try:
        like_uri = await create_like_record(
            auth_session=auth_session,
            subject_uri=subject_uri,
            subject_cid=subject_cid,
        )

        # update database with the ATProto URI
        async with db_session() as session:
            result = await session.execute(
                select(TrackLike).where(TrackLike.id == like_id)
            )
            like = result.scalar_one_or_none()
            if like:
                like.atproto_like_uri = like_uri
                await session.commit()
                logger.info(f"pds_create_like: created like record {like_uri}")
            else:
                # like was deleted before we could update it - clean up orphan
                logger.warning(f"pds_create_like: like {like_id} no longer exists")
                await delete_record_by_uri(auth_session, like_uri)

    except Exception as e:
        logger.error(f"pds_create_like failed for like {like_id}: {e}", exc_info=True)
        # note: we don't delete the DB record on failure - user still sees "liked"
        # and we can retry or fix later. this is better than inconsistent state.


async def schedule_pds_create_like(
    session_id: str,
    like_id: int,
    subject_uri: str,
    subject_cid: str,
) -> None:
    """schedule a like record creation via docket."""
    docket = get_docket()
    await docket.add(pds_create_like)(session_id, like_id, subject_uri, subject_cid)
    logfire.info("scheduled pds like creation", like_id=like_id)


async def pds_delete_like(
    session_id: str,
    like_uri: str,
) -> None:
    """delete a like record from the user's PDS.

    args:
        session_id: the user's session ID for authentication
        like_uri: AT URI of the like record to delete
    """
    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"pds_delete_like: session {session_id[:8]}... not found")
        return

    try:
        await delete_record_by_uri(auth_session, like_uri)
        logger.info(f"pds_delete_like: deleted like record {like_uri}")
    except Exception as e:
        logger.error(f"pds_delete_like failed for {like_uri}: {e}", exc_info=True)
        # deletion failed - the PDS record may still exist, but DB is already clean
        # this is acceptable: orphaned PDS records are harmless


async def schedule_pds_delete_like(session_id: str, like_uri: str) -> None:
    """schedule a like record deletion via docket."""
    docket = get_docket()
    await docket.add(pds_delete_like)(session_id, like_uri)
    logfire.info("scheduled pds like deletion", like_uri=like_uri)


async def pds_create_comment(
    session_id: str,
    comment_id: int,
    subject_uri: str,
    subject_cid: str,
    text: str,
    timestamp_ms: int,
) -> None:
    """create a comment record on the user's PDS and update the database.

    args:
        session_id: the user's session ID for authentication
        comment_id: database ID of the TrackComment record to update
        subject_uri: AT URI of the track being commented on
        subject_cid: CID of the track being commented on
        text: comment text
        timestamp_ms: playback position when comment was made
    """
    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"pds_create_comment: session {session_id[:8]}... not found")
        return

    try:
        comment_uri = await create_comment_record(
            auth_session=auth_session,
            subject_uri=subject_uri,
            subject_cid=subject_cid,
            text=text,
            timestamp_ms=timestamp_ms,
        )

        # update database with the ATProto URI
        async with db_session() as session:
            result = await session.execute(
                select(TrackComment).where(TrackComment.id == comment_id)
            )
            comment = result.scalar_one_or_none()
            if comment:
                comment.atproto_comment_uri = comment_uri
                await session.commit()
                logger.info(f"pds_create_comment: created comment record {comment_uri}")
            else:
                # comment was deleted before we could update it - clean up orphan
                logger.warning(
                    f"pds_create_comment: comment {comment_id} no longer exists"
                )
                await delete_record_by_uri(auth_session, comment_uri)

    except Exception as e:
        logger.error(
            f"pds_create_comment failed for comment {comment_id}: {e}", exc_info=True
        )


async def schedule_pds_create_comment(
    session_id: str,
    comment_id: int,
    subject_uri: str,
    subject_cid: str,
    text: str,
    timestamp_ms: int,
) -> None:
    """schedule a comment record creation via docket."""
    docket = get_docket()
    await docket.add(pds_create_comment)(
        session_id, comment_id, subject_uri, subject_cid, text, timestamp_ms
    )
    logfire.info("scheduled pds comment creation", comment_id=comment_id)


async def pds_delete_comment(
    session_id: str,
    comment_uri: str,
) -> None:
    """delete a comment record from the user's PDS.

    args:
        session_id: the user's session ID for authentication
        comment_uri: AT URI of the comment record to delete
    """
    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"pds_delete_comment: session {session_id[:8]}... not found")
        return

    try:
        await delete_record_by_uri(auth_session, comment_uri)
        logger.info(f"pds_delete_comment: deleted comment record {comment_uri}")
    except Exception as e:
        logger.error(f"pds_delete_comment failed for {comment_uri}: {e}", exc_info=True)


async def schedule_pds_delete_comment(session_id: str, comment_uri: str) -> None:
    """schedule a comment record deletion via docket."""
    docket = get_docket()
    await docket.add(pds_delete_comment)(session_id, comment_uri)
    logfire.info("scheduled pds comment deletion", comment_uri=comment_uri)


async def pds_update_comment(
    session_id: str,
    comment_id: int,
    comment_uri: str,
    subject_uri: str,
    subject_cid: str,
    text: str,
    timestamp_ms: int,
    created_at: datetime,
) -> None:
    """update a comment record on the user's PDS.

    args:
        session_id: the user's session ID for authentication
        comment_id: database ID of the TrackComment record
        comment_uri: AT URI of the comment record to update
        subject_uri: AT URI of the track being commented on
        subject_cid: CID of the track being commented on
        text: new comment text
        timestamp_ms: playback position when comment was made
        created_at: original creation timestamp
    """
    auth_session = await get_session(session_id)
    if not auth_session:
        logger.warning(f"pds_update_comment: session {session_id[:8]}... not found")
        return

    try:
        await update_comment_record(
            auth_session=auth_session,
            comment_uri=comment_uri,
            subject_uri=subject_uri,
            subject_cid=subject_cid,
            text=text,
            timestamp_ms=timestamp_ms,
            created_at=created_at,
            updated_at=datetime.now(UTC),
        )
        logger.info(f"pds_update_comment: updated comment record {comment_uri}")
    except Exception as e:
        logger.error(
            f"pds_update_comment failed for comment {comment_id}: {e}", exc_info=True
        )


async def schedule_pds_update_comment(
    session_id: str,
    comment_id: int,
    comment_uri: str,
    subject_uri: str,
    subject_cid: str,
    text: str,
    timestamp_ms: int,
    created_at: datetime,
) -> None:
    """schedule a comment record update via docket."""
    docket = get_docket()
    await docket.add(pds_update_comment)(
        session_id,
        comment_id,
        comment_uri,
        subject_uri,
        subject_cid,
        text,
        timestamp_ms,
        created_at,
    )
    logfire.info("scheduled pds comment update", comment_id=comment_id)
