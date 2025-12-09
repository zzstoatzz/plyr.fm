"""fm.teal.actor.status record operations (now playing)."""

from datetime import UTC, datetime
from typing import Any

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request
from backend.config import settings


def build_teal_status_record(
    track_name: str,
    artist_name: str,
    duration: int | None = None,
    album_name: str | None = None,
    origin_url: str | None = None,
) -> dict[str, Any]:
    """build a teal.fm actor status record (now playing).

    args:
        track_name: track title
        artist_name: primary artist name
        duration: track duration in seconds
        album_name: optional album/release name
        origin_url: optional URL to the track on plyr.fm

    returns:
        record dict ready for ATProto
    """
    now = datetime.now(UTC)
    # expiry defaults to 10 minutes from now
    expiry = datetime.fromtimestamp(now.timestamp() + 600, UTC)

    # build the playView item
    item: dict[str, Any] = {
        "trackName": track_name,
        "artists": [{"artistName": artist_name}],
        "musicServiceBaseDomain": "plyr.fm",
        "submissionClientAgent": "plyr.fm/1.0",
        "playedTime": now.isoformat().replace("+00:00", "Z"),
    }

    if duration:
        item["duration"] = duration
    if album_name:
        item["releaseName"] = album_name
    if origin_url:
        item["originUrl"] = origin_url

    record: dict[str, Any] = {
        "$type": settings.teal.status_collection,
        "time": now.isoformat().replace("+00:00", "Z"),
        "expiry": expiry.isoformat().replace("+00:00", "Z"),
        "item": item,
    }

    return record


async def update_teal_status(
    auth_session: AuthSession,
    track_name: str,
    artist_name: str,
    duration: int | None = None,
    album_name: str | None = None,
    origin_url: str | None = None,
) -> str:
    """update the user's teal.fm status (now playing).

    uses putRecord with rkey "self" as per the lexicon spec.

    args:
        auth_session: authenticated user session with teal scopes
        track_name: track title
        artist_name: primary artist name
        duration: track duration in seconds
        album_name: optional album/release name
        origin_url: optional URL to the track on plyr.fm

    returns:
        record URI

    raises:
        ValueError: if session is invalid
        Exception: if record creation fails
    """
    record = build_teal_status_record(
        track_name=track_name,
        artist_name=artist_name,
        duration=duration,
        album_name=album_name,
        origin_url=origin_url,
    )

    payload = {
        "repo": auth_session.did,
        "collection": settings.teal.status_collection,
        "rkey": "self",
        "record": record,
    }

    result = await make_pds_request(
        auth_session, "POST", "com.atproto.repo.putRecord", payload
    )
    return result["uri"]
