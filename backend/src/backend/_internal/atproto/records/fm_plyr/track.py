"""fm.plyr.track record operations."""

import logging
from datetime import UTC, datetime
from typing import Any

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import BlobRef, make_pds_request, parse_at_uri
from backend.config import settings

logger = logging.getLogger(__name__)


def build_track_record(
    title: str,
    artist: str,
    audio_url: str,
    file_type: str,
    album: str | None = None,
    duration: int | None = None,
    features: list[dict[str, Any]] | None = None,
    image_url: str | None = None,
    support_gate: dict[str, Any] | None = None,
    audio_blob: BlobRef | None = None,
) -> dict[str, Any]:
    """Build a track record dict for ATProto.

    args:
        title: track title
        artist: artist name
        audio_url: R2 URL for audio file (placeholder for gated tracks)
        file_type: file extension (mp3, wav, etc)
        album: optional album name
        duration: optional duration in seconds
        features: optional list of featured artists [{did, handle, display_name, avatar_url}]
        image_url: optional cover art image URL
        support_gate: optional gating config (e.g., {"type": "any"})
        audio_blob: optional blob reference from PDS upload (canonical source when present)

    returns:
        record dict ready for ATProto
    """
    record: dict[str, Any] = {
        "$type": settings.atproto.track_collection,
        "title": title,
        "artist": artist,
        "audioUrl": audio_url,
        "fileType": file_type,
        "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }

    # add optional fields
    if album:
        record["album"] = album
    if duration:
        record["duration"] = duration
    if features:
        # only include essential fields for ATProto record
        record["features"] = [
            {
                "did": f["did"],
                "handle": f["handle"],
                "displayName": f.get("display_name", f["handle"]),
            }
            for f in features
        ]
    if image_url:
        # validate image URL comes from allowed origin
        settings.storage.validate_image_url(image_url)
        record["imageUrl"] = image_url
    if support_gate:
        record["supportGate"] = support_gate
    if audio_blob:
        record["audioBlob"] = audio_blob

    return record


async def create_track_record(
    auth_session: AuthSession,
    title: str,
    artist: str,
    audio_url: str,
    file_type: str,
    album: str | None = None,
    duration: int | None = None,
    features: list[dict[str, Any]] | None = None,
    image_url: str | None = None,
    support_gate: dict[str, Any] | None = None,
    audio_blob: BlobRef | None = None,
) -> tuple[str, str]:
    """Create a track record on the user's PDS using the configured collection.

    args:
        auth_session: authenticated user session
        title: track title
        artist: artist name
        audio_url: R2 URL for audio file (placeholder URL for gated tracks)
        file_type: file extension (mp3, wav, etc)
        album: optional album name
        duration: optional duration in seconds
        features: optional list of featured artists [{did, handle, display_name, avatar_url}]
        image_url: optional cover art image URL
        support_gate: optional gating config (e.g., {"type": "any"})
        audio_blob: optional blob reference from PDS upload (canonical source when present)

    returns:
        tuple of (record_uri, record_cid)

    raises:
        ValueError: if session is invalid
        Exception: if record creation fails
    """
    record = build_track_record(
        title=title,
        artist=artist,
        audio_url=audio_url,
        file_type=file_type,
        album=album,
        duration=duration,
        features=features,
        image_url=image_url,
        support_gate=support_gate,
        audio_blob=audio_blob,
    )

    payload = {
        "repo": auth_session.did,
        "collection": settings.atproto.track_collection,
        "record": record,
    }

    result = await make_pds_request(
        auth_session, "POST", "com.atproto.repo.createRecord", payload
    )
    return result["uri"], result["cid"]


async def get_record_public(
    record_uri: str,
    pds_url: str | None = None,
) -> dict[str, Any]:
    """fetch an ATProto record without authentication.

    ATProto records are public by design - any client can read them.
    uses the owner's PDS URL if provided, otherwise falls back to
    bsky.network relay which indexes all public records.

    args:
        record_uri: AT URI of the record (at://did/collection/rkey)
        pds_url: optional PDS URL to use (falls back to bsky.network)

    returns:
        the record value dict

    raises:
        ValueError: if URI is malformed
        Exception: if fetch fails
    """
    import httpx
    import logfire

    repo, collection, rkey = parse_at_uri(record_uri)

    base_url = pds_url or "https://bsky.network"
    url = f"{base_url}/xrpc/com.atproto.repo.getRecord"
    params = {"repo": repo, "collection": collection, "rkey": rkey}

    with logfire.span(
        "pds_get_record {collection}",
        collection=collection,
        rkey=rkey,
        pds_host=base_url.replace("https://", ""),
    ):
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=10.0)

    if response.status_code != 200:
        raise Exception(
            f"failed to fetch record: {response.status_code} {response.text}"
        )

    return response.json()


async def update_record(
    auth_session: AuthSession,
    record_uri: str,
    record: dict[str, Any],
) -> tuple[str, str]:
    """Update an existing record on the user's PDS.

    args:
        auth_session: authenticated user session
        record_uri: AT URI of the record to update (e.g., at://did:plc:.../fm.plyr.track/...)
        record: complete record data to update with (must include $type)

    returns:
        tuple of (record_uri, record_cid)

    raises:
        ValueError: if session is invalid or URI is malformed
        Exception: if record update fails
    """
    repo, collection, rkey = parse_at_uri(record_uri)

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


async def delete_record_by_uri(
    auth_session: AuthSession,
    record_uri: str,
) -> None:
    """delete a record on the user's PDS.

    args:
        auth_session: authenticated user session
        record_uri: AT URI of the record to delete

    raises:
        ValueError: if session is invalid or URI is malformed
        Exception: if record deletion fails
    """
    repo, collection, rkey = parse_at_uri(record_uri)

    payload = {
        "repo": repo,
        "collection": collection,
        "rkey": rkey,
    }

    await make_pds_request(
        auth_session,
        "POST",
        "com.atproto.repo.deleteRecord",
        payload,
        success_codes=(200, 201, 204),
    )
