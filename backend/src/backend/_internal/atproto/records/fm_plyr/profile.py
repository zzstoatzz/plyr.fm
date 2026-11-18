"""fm.plyr.profile record operations."""

from datetime import UTC, datetime
from typing import Any

from backend._internal import Session as AuthSession
from backend._internal import get_oauth_client
from backend._internal.atproto.client import make_pds_request, reconstruct_oauth_session
from backend.config import settings


def build_profile_record(
    bio: str | None = None,
    avatar: str | None = None,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> dict[str, Any]:
    """Build a profile record dict for ATProto.

    args:
        bio: artist bio/description
        avatar: URL to avatar image
        created_at: creation timestamp (defaults to now)
        updated_at: optional last modification timestamp

    returns:
        record dict ready for ATProto
    """
    record: dict[str, Any] = {
        "$type": settings.atproto.profile_collection,
        "createdAt": (created_at or datetime.now(UTC))
        .isoformat()
        .replace("+00:00", "Z"),
    }

    if avatar:
        record["avatar"] = avatar
    if bio:
        record["bio"] = bio
    if updated_at:
        record["updatedAt"] = updated_at.isoformat().replace("+00:00", "Z")

    return record


async def upsert_profile_record(
    auth_session: AuthSession,
    bio: str | None = None,
    avatar: str | None = None,
) -> tuple[str, str] | None:
    """Create or update the user's plyr.fm profile record.

    the write starts from the existing record, so fields other clients wrote
    (`displayName`, `avatarBlob`, ...) survive. an uploaded avatar
    (`avatarBlob`) is the user's choice and `avatar` never replaces it.
    `avatar=None` leaves the current avatar as it is.

    returns:
        tuple of (record_uri, record_cid) or None if skipped (unchanged)
    """
    existing: dict[str, Any] | None = None
    existing_cid: str | None = None

    try:
        oauth_data = auth_session.oauth_session
        if oauth_data and "pds_url" in oauth_data:
            oauth_session = await reconstruct_oauth_session(oauth_data)
            response = await get_oauth_client().make_authenticated_request(
                session=oauth_session,
                method="GET",
                url=f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.getRecord",
                params={
                    "repo": auth_session.did,
                    "collection": settings.atproto.profile_collection,
                    "rkey": "self",
                },
            )
            if response.status_code == 200:
                body = response.json()
                if isinstance(value := body.get("value"), dict):
                    existing = value
                    existing_cid = body.get("cid")
    except Exception:
        pass

    if existing is None:
        record = build_profile_record(bio=bio, avatar=avatar)
    else:
        record = {**existing, "$type": settings.atproto.profile_collection}
        if bio:
            record["bio"] = bio
        else:
            record.pop("bio", None)
        if avatar and "avatarBlob" not in existing:
            record["avatar"] = avatar
        if record == existing:
            return None
        record["updatedAt"] = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    payload: dict[str, Any] = {
        "repo": auth_session.did,
        "collection": settings.atproto.profile_collection,
        "rkey": "self",
        "record": record,
    }
    if existing_cid:
        payload["swapRecord"] = existing_cid

    result = await make_pds_request(
        auth_session, "POST", "com.atproto.repo.putRecord", payload
    )
    return result["uri"], result["cid"]
