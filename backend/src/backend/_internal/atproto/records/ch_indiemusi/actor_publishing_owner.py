"""ch.indiemusi.alpha.actor.publishingOwner record operations.

a publishingOwner identifies a songwriter, composer, or music publisher who owns
publishing rights to a song. for plyr.fm this is written once during portal
setup to advertise the user's publishing identity, and the same field values are
inlined into every song's interestedParties on upload.
"""

from typing import Any

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request
from backend._internal.atproto.records.ch_indiemusi.models import PublishingOwnerInput
from backend.config import settings


def build_publishing_owner_record(data: PublishingOwnerInput) -> dict[str, Any]:
    """build the record body for an actor.publishingOwner write.

    fields are dumped under their camelCase lexicon aliases; null fields are
    omitted so we don't write empty strings the lexicon allows but doesn't expect.
    """
    record: dict[str, Any] = {
        "$type": settings.indiemusi.publishing_owner_collection,
    }
    payload = data.model_dump(by_alias=True, exclude_none=True)
    record.update(payload)
    return record


def build_publishing_owner_value(data: PublishingOwnerInput) -> dict[str, Any]:
    """build the publishingOwner sub-object that gets inlined into an
    interestedParty entry on a song record.

    same shape as the standalone record body — the lexicon's ref to publishingOwner
    is satisfied by any object matching that shape with the right $type.
    """
    return build_publishing_owner_record(data)


async def create_publishing_owner_record(
    auth_session: AuthSession,
    data: PublishingOwnerInput,
    rkey: str | None = None,
) -> tuple[str, str]:
    """create or upsert a publishingOwner record on the user's PDS.

    when rkey is provided, uses putRecord for idempotent upsert. otherwise
    createRecord lets the PDS assign a TID.

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
