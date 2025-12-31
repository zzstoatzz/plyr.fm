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

    uses putRecord with rkey="self" for upsert semantics - creates if
    doesn't exist, updates if it does. skips write if record already
    exists with the same bio and avatar (no-op for unchanged data).

    args:
        auth_session: authenticated user session
        bio: artist bio/description
        avatar: URL to avatar image

    returns:
        tuple of (record_uri, record_cid) or None if skipped (unchanged)
    """
    # check if profile already exists to preserve createdAt and skip if unchanged
    existing_created_at = None
    existing_bio = None
    existing_avatar = None
    existing_uri = None
    existing_cid = None

    try:
        # try to get existing record
        oauth_data = auth_session.oauth_session
        if oauth_data and "pds_url" in oauth_data:
            oauth_session = reconstruct_oauth_session(oauth_data)
            url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.getRecord"
            params = {
                "repo": auth_session.did,
                "collection": settings.atproto.profile_collection,
                "rkey": "self",
            }
            response = await get_oauth_client().make_authenticated_request(
                session=oauth_session,
                method="GET",
                url=url,
                params=params,
            )
            if response.status_code == 200:
                existing = response.json()
                existing_uri = existing.get("uri")
                existing_cid = existing.get("cid")
                if "value" in existing:
                    existing_bio = existing["value"].get("bio")
                    existing_avatar = existing["value"].get("avatar")
                    if "createdAt" in existing["value"]:
                        existing_created_at = datetime.fromisoformat(
                            existing["value"]["createdAt"].replace("Z", "+00:00")
                        )
    except Exception:
        # record doesn't exist yet, that's fine
        pass

    # skip write if record exists with same bio and avatar (no changes needed)
    if (
        existing_uri
        and existing_cid
        and existing_bio == bio
        and existing_avatar == avatar
    ):
        return None

    record = build_profile_record(
        bio=bio,
        avatar=avatar,
        created_at=existing_created_at,
        updated_at=datetime.now(UTC) if existing_created_at else None,
    )

    payload = {
        "repo": auth_session.did,
        "collection": settings.atproto.profile_collection,
        "rkey": "self",
        "record": record,
    }

    result = await make_pds_request(
        auth_session, "POST", "com.atproto.repo.putRecord", payload
    )
    return result["uri"], result["cid"]
