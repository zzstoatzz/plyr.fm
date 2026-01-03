"""track record operations (fm.plyr.track and audio.ooo.track)."""

import logging
from datetime import UTC, datetime
from typing import Any

from backend._internal import Session as AuthSession
from backend._internal.atproto.client import make_pds_request, parse_at_uri
from backend.config import settings

logger = logging.getLogger(__name__)

# file extension to MIME type mapping
MIME_TYPES: dict[str, str] = {
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "ogg": "audio/ogg",
    "opus": "audio/opus",
    "aac": "audio/aac",
    "webm": "audio/webm",
}


def file_type_to_mime(file_type: str) -> str:
    """Convert file extension to MIME type."""
    return MIME_TYPES.get(file_type.lower(), f"audio/{file_type.lower()}")


def mime_to_file_type(mime_type: str) -> str:
    """Convert MIME type back to file extension."""
    # reverse lookup
    for ext, mime in MIME_TYPES.items():
        if mime == mime_type:
            return ext
    # fallback: extract from mime type (audio/xyz -> xyz)
    if "/" in mime_type:
        return mime_type.split("/")[1]
    return mime_type


def normalize_track_record(record: dict[str, Any]) -> dict[str, Any]:
    """Normalize a track record from either schema to a common format.

    Handles both:
    - audio.ooo.track (shared schema): uri, mimeType, duration in ms
    - fm.plyr.track (legacy): audioUrl, fileType, duration in seconds

    Returns a normalized dict with plyr's internal field names.
    """
    # detect which schema by presence of 'uri' vs 'audioUrl'
    is_shared_schema = "uri" in record and "mimeType" in record

    if is_shared_schema:
        # shared audio.ooo.track schema
        normalized = {
            "title": record.get("title"),
            "audioUrl": record.get("uri"),  # uri -> audioUrl
            "fileType": record.get("fileType")
            or mime_to_file_type(record.get("mimeType", "")),
            "createdAt": record.get("createdAt"),
        }
        # duration: shared uses ms, convert to seconds
        if record.get("duration"):
            normalized["duration"] = record["duration"] // 1000
    else:
        # legacy fm.plyr.track schema
        normalized = {
            "title": record.get("title"),
            "audioUrl": record.get("audioUrl"),
            "fileType": record.get("fileType"),
            "createdAt": record.get("createdAt"),
        }
        if record.get("duration"):
            normalized["duration"] = record["duration"]

    # copy extension fields that exist in both schemas
    for field in [
        "artist",
        "album",
        "features",
        "imageUrl",
        "supportGate",
        "description",
    ]:
        if field in record:
            normalized[field] = record[field]

    return normalized


def get_readable_collections() -> list[str]:
    """Get list of collections to read track records from.

    Returns the effective track collection plus any legacy collections
    that should still be readable for backwards compatibility.
    """
    collections = [settings.atproto.effective_track_collection]

    # always include legacy collection if different from effective
    legacy = settings.atproto.track_collection
    if legacy not in collections:
        collections.append(legacy)

    # include old namespace collection if configured
    old = settings.atproto.old_track_collection
    if old and old not in collections:
        collections.append(old)

    return collections


def build_track_record(
    title: str,
    artist: str,
    audio_url: str,
    file_type: str,
    album: str | None = None,
    duration: int | None = None,
    features: list[dict] | None = None,
    image_url: str | None = None,
    support_gate: dict | None = None,
) -> dict[str, Any]:
    """Build a track record dict for ATProto.

    Builds either a shared audio.ooo.track record (with plyr extensions) or
    a legacy fm.plyr.track record, depending on configuration.

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

    returns:
        record dict ready for ATProto
    """
    collection = settings.atproto.effective_track_collection
    use_shared = (
        settings.atproto.use_shared_track_writes
        and settings.atproto.shared_track_collection
    )
    created_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    if use_shared:
        # shared audio.ooo.track schema with plyr extensions
        record: dict[str, Any] = {
            "$type": collection,
            # base audio.ooo.track fields
            "title": title,
            "uri": audio_url,
            "mimeType": file_type_to_mime(file_type),
            "createdAt": created_at,
            # plyr extensions (pass through validation per standard.site pattern)
            "artist": artist,
            "fileType": file_type,  # keep for backwards compat
        }
        # duration: shared schema uses milliseconds, plyr uses seconds
        if duration:
            record["duration"] = duration * 1000
    else:
        # legacy fm.plyr.track schema
        record = {
            "$type": collection,
            "title": title,
            "artist": artist,
            "audioUrl": audio_url,
            "fileType": file_type,
            "createdAt": created_at,
        }
        if duration:
            record["duration"] = duration

    # add optional fields (same for both schemas, as extensions)
    if album:
        record["album"] = album
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

    return record


async def create_track_record(
    auth_session: AuthSession,
    title: str,
    artist: str,
    audio_url: str,
    file_type: str,
    album: str | None = None,
    duration: int | None = None,
    features: list[dict] | None = None,
    image_url: str | None = None,
    support_gate: dict | None = None,
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
    )

    payload = {
        "repo": auth_session.did,
        "collection": settings.atproto.effective_track_collection,
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

    repo, collection, rkey = parse_at_uri(record_uri)

    base_url = pds_url or "https://bsky.network"
    url = f"{base_url}/xrpc/com.atproto.repo.getRecord"
    params = {"repo": repo, "collection": collection, "rkey": rkey}

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
