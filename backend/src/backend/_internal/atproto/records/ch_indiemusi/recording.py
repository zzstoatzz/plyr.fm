"""ch.indiemusi.alpha.recording record operations.

a recording captures performance/master-level metadata for a specific recording
of a song: ISRC, artists, duration, master owner. recordings can inline the song
they're a recording of.

plyr.fm intentionally does not populate the `audioFile` blob field — copyright-
flagged tracks live in private storage, not as a publicly-readable PDS blob.
"""

from typing import Any

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import (
    make_pds_request,
    parse_at_uri,
)
from backend._internal.atproto.records.ch_indiemusi.models import RecordingInput
from backend._internal.atproto.records.ch_indiemusi.song import build_song_value
from backend.config import settings


def build_recording_record(data: RecordingInput) -> dict[str, Any]:
    """build the record body for a recording write."""
    record: dict[str, Any] = {
        "$type": settings.indiemusi.recording_collection,
        "title": data.title,
        "artists": [
            a.model_dump(by_alias=True, exclude_none=True) for a in data.artists
        ],
    }
    if data.isrc:
        record["isrc"] = data.isrc
    if data.duration is not None:
        record["duration"] = data.duration
    if data.master_owner is not None:
        record["masterOwner"] = data.master_owner.model_dump(
            by_alias=True, exclude_none=True
        )
    if data.song is not None:
        record["song"] = build_song_value(data.song)
    return record


async def create_recording_record(
    auth_session: AuthSession,
    data: RecordingInput,
    rkey: str | None = None,
) -> tuple[str, str]:
    """create a recording record on the user's PDS. returns (uri, cid)."""
    payload: dict[str, Any] = {
        "repo": auth_session.did,
        "collection": settings.indiemusi.recording_collection,
        "record": build_recording_record(data),
    }
    if rkey:
        payload["rkey"] = rkey
        endpoint = "com.atproto.repo.putRecord"
    else:
        endpoint = "com.atproto.repo.createRecord"

    result = await make_pds_request(auth_session, "POST", endpoint, payload)
    return result["uri"], result["cid"]


async def update_recording_record(
    auth_session: AuthSession,
    record_uri: str,
    data: RecordingInput,
) -> tuple[str, str]:
    """update an existing recording record at the given AT-URI."""
    repo, collection, rkey = parse_at_uri(record_uri)
    payload = {
        "repo": repo,
        "collection": collection,
        "rkey": rkey,
        "record": build_recording_record(data),
    }
    result = await make_pds_request(
        auth_session, "POST", "com.atproto.repo.putRecord", payload
    )
    return result["uri"], result["cid"]


async def delete_recording_record(auth_session: AuthSession, record_uri: str) -> None:
    """delete a recording record from the user's PDS."""
    repo, collection, rkey = parse_at_uri(record_uri)
    await make_pds_request(
        auth_session,
        "POST",
        "com.atproto.repo.deleteRecord",
        {"repo": repo, "collection": collection, "rkey": rkey},
        success_codes=(200, 201, 204),
    )
