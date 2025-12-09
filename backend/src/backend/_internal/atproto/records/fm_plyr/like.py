"""fm.plyr.like record operations."""

from datetime import UTC, datetime

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request
from backend.config import settings


async def create_like_record(
    auth_session: AuthSession,
    subject_uri: str,
    subject_cid: str,
) -> str:
    """create a like record on the user's PDS.

    args:
        auth_session: authenticated user session
        subject_uri: AT URI of the track being liked
        subject_cid: CID of the track being liked

    returns:
        like record URI

    raises:
        ValueError: if session is invalid
        Exception: if record creation fails
    """
    record = {
        "$type": settings.atproto.like_collection,
        "subject": {
            "uri": subject_uri,
            "cid": subject_cid,
        },
        "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }

    payload = {
        "repo": auth_session.did,
        "collection": settings.atproto.like_collection,
        "record": record,
    }

    result = await make_pds_request(
        auth_session, "POST", "com.atproto.repo.createRecord", payload
    )
    return result["uri"]
