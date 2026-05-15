"""ch.indiemusi.alpha.actor.publishingOwner record operations.

a publishingOwner identifies a songwriter, composer, or music publisher who owns
publishing rights to a song. the same field set is also inlined into each
song record's interestedParties.
"""

from typing import Any

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request, parse_at_uri
from backend._internal.atproto.records.ch_indiemusi.models import PublishingOwnerInput
from backend.config import settings

# fields in the lexicon we model. on a merge-preserve edit (see
# `merge_publishing_owner_for_put`) we replace this set as a group so
# individual↔company switches actually clear the stale shape. anything outside
# this set is preserved from whatever's already on the PDS — gives other
# clients (and future lexicon extensions) room to write fields plyr doesn't
# know about without us silently dropping them on every save.
KNOWN_OWNER_KEYS: frozenset[str] = frozenset(
    {"$type", "ipi", "firstName", "lastName", "companyName", "collectingSociety"}
)


def build_publishing_owner_record(data: PublishingOwnerInput) -> dict[str, Any]:
    """build the record body for an actor.publishingOwner write or inline use.

    fields are dumped under their camelCase lexicon aliases; null fields are
    omitted.
    """
    return {
        "$type": settings.indiemusi.publishing_owner_collection,
        **data.model_dump(by_alias=True, exclude_none=True),
    }


def merge_publishing_owner_for_put(
    fresh_value: dict[str, Any], data: PublishingOwnerInput
) -> dict[str, Any]:
    """merge a fetched record value with the user's input for a putRecord.

    drops every key plyr models (so a switch from individual → company actually
    removes firstName/lastName instead of leaving them sticky), restores
    `$type`, then spreads the validated input. keys plyr doesn't model are
    carried through untouched.
    """
    merged = {k: v for k, v in fresh_value.items() if k not in KNOWN_OWNER_KEYS}
    merged["$type"] = settings.indiemusi.publishing_owner_collection
    merged.update(data.model_dump(by_alias=True, exclude_none=True))
    return merged


async def create_publishing_owner_record(
    auth_session: AuthSession,
    data: PublishingOwnerInput,
    rkey: str | None = None,
) -> tuple[str, str]:
    """create or upsert a publishingOwner record on the user's PDS.

    when rkey is provided, uses putRecord for idempotent upsert.
    returns (record_uri, record_cid).
    """
    payload: dict[str, Any] = {
        "repo": auth_session.did,
        "collection": settings.indiemusi.publishing_owner_collection,
        "record": build_publishing_owner_record(data),
    }
    if rkey:
        payload["rkey"] = rkey
        endpoint = "com.atproto.repo.putRecord"
    else:
        endpoint = "com.atproto.repo.createRecord"

    result = await make_pds_request(auth_session, "POST", endpoint, payload)
    return result["uri"], result["cid"]


async def get_publishing_owner_record(
    auth_session: AuthSession, uri: str
) -> dict[str, Any]:
    """fetch a single publishingOwner record from the user's PDS.

    authenticated read against the session user's PDS — handles ATProto record
    semantics regardless of whether the record is on a public PDS or a private
    one. returns the parsed `{uri, cid, value}` envelope.
    """
    repo, collection, rkey = parse_at_uri(uri)
    return await make_pds_request(
        auth_session,
        "GET",
        "com.atproto.repo.getRecord",
        params={"repo": repo, "collection": collection, "rkey": rkey},
    )


async def list_publishing_owner_records(
    auth_session: AuthSession, limit: int = 100
) -> list[dict[str, Any]]:
    """list all of the user's publishingOwner records from their PDS.

    paged listRecords call against the session user's PDS — most users will
    have 0-2 records, so a single page suffices unless the user happens to be
    a publishing house. returns the raw record envelopes.
    """
    result = await make_pds_request(
        auth_session,
        "GET",
        "com.atproto.repo.listRecords",
        params={
            "repo": auth_session.did,
            "collection": settings.indiemusi.publishing_owner_collection,
            "limit": limit,
        },
    )
    records = result.get("records", [])
    return records if isinstance(records, list) else []


async def put_publishing_owner_record(
    auth_session: AuthSession, uri: str, record: dict[str, Any]
) -> tuple[str, str]:
    """putRecord against an existing publishingOwner URI.

    caller is responsible for assembling the record body (typically via
    `merge_publishing_owner_for_put` on a freshly-fetched value).
    """
    repo, collection, rkey = parse_at_uri(uri)
    payload = {
        "repo": repo,
        "collection": collection,
        "rkey": rkey,
        "record": record,
    }
    result = await make_pds_request(
        auth_session, "POST", "com.atproto.repo.putRecord", payload
    )
    return result["uri"], result["cid"]


async def delete_publishing_owner_record(auth_session: AuthSession, uri: str) -> None:
    """delete a publishingOwner record from the user's PDS."""
    repo, collection, rkey = parse_at_uri(uri)
    await make_pds_request(
        auth_session,
        "POST",
        "com.atproto.repo.deleteRecord",
        {"repo": repo, "collection": collection, "rkey": rkey},
        success_codes=(200, 201, 204),
    )
