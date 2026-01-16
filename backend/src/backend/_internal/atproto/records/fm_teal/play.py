"""fm.teal.play record operations (scrobbling).

uses putRecord with deterministic TID rkeys for idempotent scrobbles.
this prevents duplicate records when the same play is submitted multiple times
(e.g., network retries, or user has multiple teal-compatible services).

see: https://badlogic.bsky.social/blog/bitesize-proto-upserting-atproto-records
"""

from datetime import UTC, datetime
from typing import Any

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request
from backend._internal.atproto.tid import datetime_to_tid
from backend.config import settings


def build_teal_play_record(
    track_name: str,
    artist_name: str,
    played_time: datetime | None = None,
    duration: int | None = None,
    album_name: str | None = None,
    origin_url: str | None = None,
) -> dict[str, Any]:
    """build a teal.fm play record for scrobbling.

    args:
        track_name: track title
        artist_name: primary artist name
        played_time: when the track was played (defaults to now)
        duration: track duration in seconds
        album_name: optional album/release name
        origin_url: optional URL to the track on plyr.fm

    returns:
        record dict ready for ATProto
    """
    if played_time is None:
        played_time = datetime.now(UTC)

    record: dict[str, Any] = {
        "$type": settings.teal.play_collection,
        "trackName": track_name,
        "artists": [{"artistName": artist_name}],
        "musicServiceBaseDomain": "plyr.fm",
        "submissionClientAgent": "plyr.fm/1.0",
        "playedTime": played_time.isoformat().replace("+00:00", "Z"),
    }

    if duration:
        record["duration"] = duration
    if album_name:
        record["releaseName"] = album_name
    if origin_url:
        record["originUrl"] = origin_url

    return record


async def create_teal_play_record(
    auth_session: AuthSession,
    track_name: str,
    artist_name: str,
    played_time: datetime | None = None,
    duration: int | None = None,
    album_name: str | None = None,
    origin_url: str | None = None,
) -> str:
    """create or update a teal.fm play record (scrobble) on the user's PDS.

    uses putRecord with a deterministic TID derived from played_time for
    idempotent submissions. submitting the same play twice will update
    the existing record rather than creating a duplicate.

    args:
        auth_session: authenticated user session with teal scopes
        track_name: track title
        artist_name: primary artist name
        played_time: when the track was played (defaults to now)
        duration: track duration in seconds
        album_name: optional album/release name
        origin_url: optional URL to the track on plyr.fm

    returns:
        record URI

    raises:
        ValueError: if session is invalid
        Exception: if record creation fails
    """
    if played_time is None:
        played_time = datetime.now(UTC)

    record = build_teal_play_record(
        track_name=track_name,
        artist_name=artist_name,
        played_time=played_time,
        duration=duration,
        album_name=album_name,
        origin_url=origin_url,
    )

    # generate deterministic rkey from played_time for idempotent upserts
    rkey = datetime_to_tid(played_time)

    payload = {
        "repo": auth_session.did,
        "collection": settings.teal.play_collection,
        "rkey": rkey,
        "record": record,
    }

    result = await make_pds_request(
        auth_session, "POST", "com.atproto.repo.putRecord", payload
    )
    return result["uri"]
