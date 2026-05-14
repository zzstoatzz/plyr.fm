"""ch.indiemusi.alpha.song record operations.

a song captures composition-level metadata: title, ISWC, and the array of
interestedParties (authors, composers, publishers) with their royalty splits.
"""

from typing import Any

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import (
    make_pds_request,
    parse_at_uri,
)
from backend._internal.atproto.records.ch_indiemusi.actor_publishing_owner import (
    build_publishing_owner_value,
)
from backend._internal.atproto.records.ch_indiemusi.models import (
    InterestedPartyInput,
    SongInput,
)
from backend.config import settings


def _build_interested_party(party: InterestedPartyInput) -> dict[str, Any]:
    """build one interestedParty sub-object for inclusion in a song record."""
    entry: dict[str, Any] = party.model_dump(
        by_alias=True, exclude_none=True, exclude={"publishing_owner"}
    )
    if party.publishing_owner is not None:
        entry["publishingOwner"] = build_publishing_owner_value(party.publishing_owner)
    return entry


def build_song_record(data: SongInput) -> dict[str, Any]:
    """build the record body for a song write."""
    record: dict[str, Any] = {
        "$type": settings.indiemusi.song_collection,
        "title": data.title,
        "interestedParties": [
            _build_interested_party(p) for p in data.interested_parties
        ],
    }
    if data.iswc:
        record["iswc"] = data.iswc
    return record


def build_song_value(data: SongInput) -> dict[str, Any]:
    """build the inline song sub-object used inside a recording record.

    matches the standalone song body shape — the lexicon ref to song from
    recording is satisfied by any object matching this shape with the right $type.
    """
    return build_song_record(data)


async def create_song_record(
    auth_session: AuthSession,
    data: SongInput,
    rkey: str | None = None,
) -> tuple[str, str]:
    """create a song record on the user's PDS.

    when rkey is provided uses putRecord for idempotency. returns (uri, cid).
    """
    payload: dict[str, Any] = {
        "repo": auth_session.did,
        "collection": settings.indiemusi.song_collection,
        "record": build_song_record(data),
    }
    if rkey:
        payload["rkey"] = rkey
        endpoint = "com.atproto.repo.putRecord"
    else:
        endpoint = "com.atproto.repo.createRecord"

    result = await make_pds_request(auth_session, "POST", endpoint, payload)
    return result["uri"], result["cid"]


async def update_song_record(
    auth_session: AuthSession,
    record_uri: str,
    data: SongInput,
) -> tuple[str, str]:
    """update an existing song record at the given AT-URI."""
    repo, collection, rkey = parse_at_uri(record_uri)
    payload = {
        "repo": repo,
        "collection": collection,
        "rkey": rkey,
        "record": build_song_record(data),
    }
    result = await make_pds_request(
        auth_session, "POST", "com.atproto.repo.putRecord", payload
    )
    return result["uri"], result["cid"]


async def delete_song_record(auth_session: AuthSession, record_uri: str) -> None:
    """delete a song record from the user's PDS."""
    repo, collection, rkey = parse_at_uri(record_uri)
    await make_pds_request(
        auth_session,
        "POST",
        "com.atproto.repo.deleteRecord",
        {"repo": repo, "collection": collection, "rkey": rkey},
        success_codes=(200, 201, 204),
    )
