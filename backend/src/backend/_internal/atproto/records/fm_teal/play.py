"""fm.teal.play record operations (scrobbling)."""

from datetime import UTC, datetime
from typing import Any

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request
from backend.config import settings


def build_teal_play_record(
    track_name: str,
    artist_name: str,
    duration: int | None = None,
    album_name: str | None = None,
    origin_url: str | None = None,
) -> dict[str, Any]:
    """build a teal.fm play record for scrobbling.

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

    record: dict[str, Any] = {
        "$type": settings.teal.play_collection,
        "trackName": track_name,
        "artists": [{"artistName": artist_name}],
        "musicServiceBaseDomain": "plyr.fm",
        "submissionClientAgent": "plyr.fm/1.0",
        "playedTime": now.isoformat().replace("+00:00", "Z"),
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
    duration: int | None = None,
    album_name: str | None = None,
    origin_url: str | None = None,
) -> str:
    """create a teal.fm play record (scrobble) on the user's PDS.

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
    record = build_teal_play_record(
        track_name=track_name,
        artist_name=artist_name,
        duration=duration,
        album_name=album_name,
        origin_url=origin_url,
    )

    payload = {
        "repo": auth_session.did,
        "collection": settings.teal.play_collection,
        "record": record,
    }

    result = await make_pds_request(
        auth_session, "POST", "com.atproto.repo.createRecord", payload
    )
    return result["uri"]
