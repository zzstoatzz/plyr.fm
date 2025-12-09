"""fm.plyr.comment record operations."""

from datetime import UTC, datetime

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request
from backend._internal.atproto.records.fm_plyr.track import update_record
from backend.config import settings


async def create_comment_record(
    auth_session: AuthSession,
    subject_uri: str,
    subject_cid: str,
    text: str,
    timestamp_ms: int,
) -> str:
    """create a timed comment record on the user's PDS.

    args:
        auth_session: authenticated user session
        subject_uri: AT URI of the track being commented on
        subject_cid: CID of the track being commented on
        text: comment text content
        timestamp_ms: playback position in milliseconds when comment was made

    returns:
        comment record URI

    raises:
        ValueError: if session is invalid
        Exception: if record creation fails
    """
    record = {
        "$type": settings.atproto.comment_collection,
        "subject": {
            "uri": subject_uri,
            "cid": subject_cid,
        },
        "text": text,
        "timestampMs": timestamp_ms,
        "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }

    payload = {
        "repo": auth_session.did,
        "collection": settings.atproto.comment_collection,
        "record": record,
    }

    result = await make_pds_request(
        auth_session, "POST", "com.atproto.repo.createRecord", payload
    )
    return result["uri"]


async def update_comment_record(
    auth_session: AuthSession,
    comment_uri: str,
    subject_uri: str,
    subject_cid: str,
    text: str,
    timestamp_ms: int,
    created_at: datetime,
    updated_at: datetime,
) -> str:
    """update a timed comment record on the user's PDS.

    args:
        auth_session: authenticated user session
        comment_uri: AT URI of the comment record to update
        subject_uri: AT URI of the track being commented on
        subject_cid: CID of the track being commented on
        text: updated comment text content
        timestamp_ms: original playback position in milliseconds
        created_at: original creation timestamp
        updated_at: timestamp of this update

    returns:
        new CID for the updated record

    raises:
        ValueError: if session is invalid
        Exception: if record update fails
    """
    record = {
        "$type": settings.atproto.comment_collection,
        "subject": {
            "uri": subject_uri,
            "cid": subject_cid,
        },
        "text": text,
        "timestampMs": timestamp_ms,
        "createdAt": created_at.isoformat().replace("+00:00", "Z"),
        "updatedAt": updated_at.isoformat().replace("+00:00", "Z"),
    }

    _, new_cid = await update_record(
        auth_session=auth_session,
        record_uri=comment_uri,
        record=record,
    )
    return new_cid
