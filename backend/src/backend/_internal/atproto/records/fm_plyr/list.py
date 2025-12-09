"""fm.plyr.list record operations."""

import logging
from datetime import UTC, datetime
from typing import Any

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request
from backend._internal.atproto.records.fm_plyr.track import update_record
from backend.config import settings

logger = logging.getLogger(__name__)


def build_list_record(
    items: list[dict[str, str]],
    name: str | None = None,
    list_type: str | None = None,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> dict[str, Any]:
    """Build a list record dict for ATProto.

    args:
        items: list of record references, each with {"uri": str, "cid": str}
        name: optional display name
        list_type: optional semantic type (e.g., "album", "playlist", "liked")
        created_at: creation timestamp (defaults to now)
        updated_at: optional last modification timestamp

    returns:
        record dict ready for ATProto
    """
    record: dict[str, Any] = {
        "$type": settings.atproto.list_collection,
        "items": [
            {"subject": {"uri": item["uri"], "cid": item["cid"]}} for item in items
        ],
        "createdAt": (created_at or datetime.now(UTC))
        .isoformat()
        .replace("+00:00", "Z"),
    }

    if name:
        record["name"] = name
    if list_type:
        record["listType"] = list_type
    if updated_at:
        record["updatedAt"] = updated_at.isoformat().replace("+00:00", "Z")

    return record


async def create_list_record(
    auth_session: AuthSession,
    items: list[dict[str, str]],
    name: str | None = None,
    list_type: str | None = None,
) -> tuple[str, str]:
    """Create a list record on the user's PDS.

    args:
        auth_session: authenticated user session
        items: list of record references, each with {"uri": str, "cid": str}
        name: optional display name
        list_type: optional semantic type (e.g., "album", "playlist", "liked")

    returns:
        tuple of (record_uri, record_cid)
    """
    record = build_list_record(items=items, name=name, list_type=list_type)

    payload = {
        "repo": auth_session.did,
        "collection": settings.atproto.list_collection,
        "record": record,
    }

    result = await make_pds_request(
        auth_session, "POST", "com.atproto.repo.createRecord", payload
    )
    return result["uri"], result["cid"]


async def update_list_record(
    auth_session: AuthSession,
    list_uri: str,
    items: list[dict[str, str]],
    name: str | None = None,
    list_type: str | None = None,
    created_at: datetime | None = None,
) -> tuple[str, str]:
    """Update an existing list record on the user's PDS.

    args:
        auth_session: authenticated user session
        list_uri: AT URI of the list record to update
        items: list of record references (array order = display order)
        name: optional display name
        list_type: optional semantic type (e.g., "album", "playlist", "liked")
        created_at: original creation timestamp (preserved on updates)

    returns:
        tuple of (record_uri, new_record_cid)
    """
    record = build_list_record(
        items=items,
        name=name,
        list_type=list_type,
        created_at=created_at,
        updated_at=datetime.now(UTC),
    )

    return await update_record(
        auth_session=auth_session,
        record_uri=list_uri,
        record=record,
    )


async def upsert_album_list_record(
    auth_session: AuthSession,
    album_id: str,
    album_title: str,
    track_refs: list[dict[str, str]],
    existing_uri: str | None = None,
    existing_created_at: datetime | None = None,
) -> tuple[str, str] | None:
    """Create or update an album as a list record.

    args:
        auth_session: authenticated user session
        album_id: internal album ID (for logging)
        album_title: album display name
        track_refs: list of track references [{"uri": str, "cid": str}, ...]
        existing_uri: existing ATProto record URI if updating
        existing_created_at: original creation timestamp to preserve

    returns:
        tuple of (record_uri, record_cid) or None if no tracks to sync
    """
    if not track_refs:
        logger.debug(f"album {album_id} has no tracks with ATProto records, skipping")
        return None

    if existing_uri:
        # update existing record
        uri, cid = await update_list_record(
            auth_session=auth_session,
            list_uri=existing_uri,
            items=track_refs,
            name=album_title,
            list_type="album",
            created_at=existing_created_at,
        )
        logger.info(f"updated album list record for {album_id}: {uri}")
        return uri, cid
    else:
        # create new record
        uri, cid = await create_list_record(
            auth_session=auth_session,
            items=track_refs,
            name=album_title,
            list_type="album",
        )
        logger.info(f"created album list record for {album_id}: {uri}")
        return uri, cid


async def upsert_liked_list_record(
    auth_session: AuthSession,
    track_refs: list[dict[str, str]],
    existing_uri: str | None = None,
    existing_created_at: datetime | None = None,
) -> tuple[str, str] | None:
    """Create or update the user's liked tracks list record.

    args:
        auth_session: authenticated user session
        track_refs: list of liked track references [{"uri": str, "cid": str}, ...]
        existing_uri: existing ATProto record URI if updating
        existing_created_at: original creation timestamp to preserve

    returns:
        tuple of (record_uri, record_cid) or None if no likes to sync
    """
    if not track_refs:
        logger.debug(f"user {auth_session.did} has no liked tracks to sync")
        return None

    if existing_uri:
        # update existing record
        uri, cid = await update_list_record(
            auth_session=auth_session,
            list_uri=existing_uri,
            items=track_refs,
            name="Liked Tracks",
            list_type="liked",
            created_at=existing_created_at,
        )
        logger.info(f"updated liked list record for {auth_session.did}: {uri}")
        return uri, cid
    else:
        # create new record
        uri, cid = await create_list_record(
            auth_session=auth_session,
            items=track_refs,
            name="Liked Tracks",
            list_type="liked",
        )
        logger.info(f"created liked list record for {auth_session.did}: {uri}")
        return uri, cid
