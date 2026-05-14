"""ch.indiemusi.alpha.actor.publishingOwner record operations.

a publishingOwner identifies a songwriter, composer, or music publisher who owns
publishing rights to a song. the same field set is also inlined into each
song record's interestedParties.
"""

from typing import Any

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request
from backend._internal.atproto.records.ch_indiemusi.models import PublishingOwnerInput
from backend.config import settings


def build_publishing_owner_record(data: PublishingOwnerInput) -> dict[str, Any]:
    """build the record body for an actor.publishingOwner write or inline use.

    fields are dumped under their camelCase lexicon aliases; null fields are
    omitted.
    """
    return {
        "$type": settings.indiemusi.publishing_owner_collection,
        **data.model_dump(by_alias=True, exclude_none=True),
    }


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
