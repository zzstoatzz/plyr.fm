"""ATProto record creation for relay audio items."""

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any

from atproto_oauth.models import OAuthSession

from backend._internal import Session as AuthSession
from backend._internal import get_oauth_client, get_session, update_session_tokens
from backend.config import settings

logger = logging.getLogger(__name__)

# per-session locks for token refresh to prevent concurrent refresh races
_refresh_locks: dict[str, asyncio.Lock] = {}


def _reconstruct_oauth_session(oauth_data: dict[str, Any]) -> OAuthSession:
    """reconstruct OAuthSession from serialized data."""
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePrivateKey

    # deserialize DPoP private key
    dpop_key_pem = oauth_data.get("dpop_private_key_pem")
    if not dpop_key_pem:
        raise ValueError("DPoP private key not found in session")

    private_key = serialization.load_pem_private_key(
        dpop_key_pem.encode("utf-8"),
        password=None,
        backend=default_backend(),
    )
    if not isinstance(private_key, EllipticCurvePrivateKey):
        raise ValueError("DPoP private key must be an elliptic curve key")
    dpop_private_key: EllipticCurvePrivateKey = private_key

    return OAuthSession(
        did=oauth_data["did"],
        handle=oauth_data["handle"],
        pds_url=oauth_data["pds_url"],
        authserver_iss=oauth_data["authserver_iss"],
        access_token=oauth_data["access_token"],
        refresh_token=oauth_data["refresh_token"],
        dpop_private_key=dpop_private_key,
        dpop_authserver_nonce=oauth_data.get("dpop_authserver_nonce", ""),
        dpop_pds_nonce=oauth_data.get("dpop_pds_nonce", ""),
        scope=oauth_data["scope"],
    )


async def _refresh_session_tokens(
    auth_session: AuthSession,
    oauth_session: OAuthSession,
) -> OAuthSession:
    """refresh expired access token using refresh token.

    uses per-session locking to prevent concurrent refresh attempts for the same session.
    if another coroutine already refreshed the token, reloads from DB instead of making
    a redundant network call.
    """
    session_id = auth_session.session_id

    # get or create lock for this session
    if session_id not in _refresh_locks:
        _refresh_locks[session_id] = asyncio.Lock()

    lock = _refresh_locks[session_id]

    async with lock:
        # check if another coroutine already refreshed while we were waiting
        # reload session from DB to get potentially updated tokens
        updated_auth_session = await get_session(session_id)
        if not updated_auth_session:
            raise ValueError(f"session {session_id} no longer exists")

        # reconstruct oauth session from potentially updated data
        updated_oauth_data = updated_auth_session.oauth_session
        if not updated_oauth_data or "access_token" not in updated_oauth_data:
            raise ValueError(f"OAuth session data missing for {auth_session.did}")

        current_oauth_session = _reconstruct_oauth_session(updated_oauth_data)

        # if tokens are different from what we had, another coroutine already refreshed
        if current_oauth_session.access_token != oauth_session.access_token:
            logger.info(
                f"tokens already refreshed by another request for {auth_session.did}"
            )
            return current_oauth_session

        # we need to refresh - no one else did it yet
        logger.info(f"refreshing access token for {auth_session.did}")

        try:
            # use OAuth client to refresh tokens
            refreshed_session = await get_oauth_client().refresh_session(
                current_oauth_session
            )

            # serialize updated tokens back to database
            from cryptography.hazmat.primitives import serialization

            dpop_key_pem = refreshed_session.dpop_private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            ).decode("utf-8")

            updated_session_data = {
                "did": refreshed_session.did,
                "handle": refreshed_session.handle,
                "pds_url": refreshed_session.pds_url,
                "authserver_iss": refreshed_session.authserver_iss,
                "scope": refreshed_session.scope,
                "access_token": refreshed_session.access_token,
                "refresh_token": refreshed_session.refresh_token,
                "dpop_private_key_pem": dpop_key_pem,
                "dpop_authserver_nonce": refreshed_session.dpop_authserver_nonce,
                "dpop_pds_nonce": refreshed_session.dpop_pds_nonce or "",
            }

            # update session in database
            await update_session_tokens(session_id, updated_session_data)

            logger.info(f"successfully refreshed access token for {auth_session.did}")
            return refreshed_session

        except Exception as e:
            logger.error(
                f"failed to refresh token for {auth_session.did}: {e}", exc_info=True
            )

            # on failure, try reloading session one more time in case another
            # coroutine succeeded while we were failing
            await asyncio.sleep(0.1)  # brief pause
            retry_session = await get_session(session_id)
            if retry_session and retry_session.oauth_session:
                retry_oauth_session = _reconstruct_oauth_session(
                    retry_session.oauth_session
                )
                if retry_oauth_session.access_token != oauth_session.access_token:
                    logger.info(
                        f"using tokens refreshed by parallel request for {auth_session.did}"
                    )
                    return retry_oauth_session

            raise ValueError(f"failed to refresh access token: {e}") from e


async def _make_pds_request(
    auth_session: AuthSession,
    method: str,
    endpoint: str,
    payload: dict[str, Any],
    success_codes: tuple[int, ...] = (200, 201),
) -> dict[str, Any]:
    """make an authenticated request to the PDS with automatic token refresh.

    args:
        auth_session: authenticated user session
        method: HTTP method (POST, GET, etc.)
        endpoint: XRPC endpoint (e.g., "com.atproto.repo.createRecord")
        payload: request payload
        success_codes: HTTP status codes considered successful

    returns:
        response JSON dict (empty dict for 204 responses)

    raises:
        ValueError: if session is invalid
        Exception: if request fails after retry
    """
    oauth_data = auth_session.oauth_session
    if not oauth_data or "access_token" not in oauth_data:
        raise ValueError(
            f"OAuth session data missing or invalid for {auth_session.did}"
        )

    oauth_session = _reconstruct_oauth_session(oauth_data)
    url = f"{oauth_data['pds_url']}/xrpc/{endpoint}"

    for attempt in range(2):
        response = await get_oauth_client().make_authenticated_request(
            session=oauth_session,
            method=method,
            url=url,
            json=payload,
        )

        if response.status_code in success_codes:
            if response.status_code == 204:
                return {}
            return response.json()

        # token expired - refresh and retry
        if response.status_code == 401 and attempt == 0:
            try:
                error_data = response.json()
                if "exp" in error_data.get("message", ""):
                    logger.info(
                        f"access token expired for {auth_session.did}, attempting refresh"
                    )
                    oauth_session = await _refresh_session_tokens(
                        auth_session, oauth_session
                    )
                    continue
            except (json.JSONDecodeError, KeyError):
                pass

    raise Exception(f"PDS request failed: {response.status_code} {response.text}")


def build_track_record(
    title: str,
    artist: str,
    audio_url: str,
    file_type: str,
    album: str | None = None,
    duration: int | None = None,
    features: list[dict] | None = None,
    image_url: str | None = None,
) -> dict[str, Any]:
    """Build a track record dict for ATProto.

    args:
        title: track title
        artist: artist name
        audio_url: R2 URL for audio file
        file_type: file extension (mp3, wav, etc)
        album: optional album name
        duration: optional duration in seconds
        features: optional list of featured artists [{did, handle, display_name, avatar_url}]
        image_url: optional cover art image URL

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
) -> tuple[str, str]:
    """Create a track record on the user's PDS using the configured collection.

    args:
        auth_session: authenticated user session
        title: track title
        artist: artist name
        audio_url: R2 URL for audio file
        file_type: file extension (mp3, wav, etc)
        album: optional album name
        duration: optional duration in seconds
        features: optional list of featured artists [{did, handle, display_name, avatar_url}]
        image_url: optional cover art image URL

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
    )

    payload = {
        "repo": auth_session.did,
        "collection": settings.atproto.track_collection,
        "record": record,
    }

    result = await _make_pds_request(
        auth_session, "POST", "com.atproto.repo.createRecord", payload
    )
    return result["uri"], result["cid"]


def _parse_at_uri(uri: str) -> tuple[str, str, str]:
    """parse an AT URI into (repo, collection, rkey)."""
    if not uri.startswith("at://"):
        raise ValueError(f"Invalid AT URI format: {uri}")
    parts = uri.replace("at://", "").split("/")
    if len(parts) != 3:
        raise ValueError(f"Invalid AT URI structure: {uri}")
    return parts[0], parts[1], parts[2]


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
    repo, collection, rkey = _parse_at_uri(record_uri)

    payload = {
        "repo": repo,
        "collection": collection,
        "rkey": rkey,
        "record": record,
    }

    result = await _make_pds_request(
        auth_session, "POST", "com.atproto.repo.putRecord", payload
    )
    return result["uri"], result["cid"]


async def create_like_record(
    auth_session: AuthSession,
    subject_uri: str,
    subject_cid: str,
) -> str:
    """create a like record on the user's PDS.

    args:
        auth_session: authenticated user session
        subject_uri: AT URI of the track being liked
        subject_cid: CID of the track being liked

    returns:
        like record URI

    raises:
        ValueError: if session is invalid
        Exception: if record creation fails
    """
    record = {
        "$type": settings.atproto.like_collection,
        "subject": {
            "uri": subject_uri,
            "cid": subject_cid,
        },
        "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }

    payload = {
        "repo": auth_session.did,
        "collection": settings.atproto.like_collection,
        "record": record,
    }

    result = await _make_pds_request(
        auth_session, "POST", "com.atproto.repo.createRecord", payload
    )
    return result["uri"]


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
    repo, collection, rkey = _parse_at_uri(record_uri)

    payload = {
        "repo": repo,
        "collection": collection,
        "rkey": rkey,
    }

    await _make_pds_request(
        auth_session,
        "POST",
        "com.atproto.repo.deleteRecord",
        payload,
        success_codes=(200, 201, 204),
    )


async def create_comment_record(
    auth_session: AuthSession,
    subject_uri: str,
    subject_cid: str,
    text: str,
    timestamp_ms: int,
) -> str:
    """create a timed comment record on the user's PDS.

    args:
        auth_session: authenticated user session
        subject_uri: AT URI of the track being commented on
        subject_cid: CID of the track being commented on
        text: comment text content
        timestamp_ms: playback position in milliseconds when comment was made

    returns:
        comment record URI

    raises:
        ValueError: if session is invalid
        Exception: if record creation fails
    """
    record = {
        "$type": settings.atproto.comment_collection,
        "subject": {
            "uri": subject_uri,
            "cid": subject_cid,
        },
        "text": text,
        "timestampMs": timestamp_ms,
        "createdAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }

    payload = {
        "repo": auth_session.did,
        "collection": settings.atproto.comment_collection,
        "record": record,
    }

    result = await _make_pds_request(
        auth_session, "POST", "com.atproto.repo.createRecord", payload
    )
    return result["uri"]


def build_list_record(
    items: list[dict[str, str]],
    name: str | None = None,
    list_type: str | None = None,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> dict[str, Any]:
    """Build a list record dict for ATProto.

    args:
        items: list of record references, each with {"uri": str, "cid": str}
        name: optional display name
        list_type: optional semantic type (e.g., "album", "playlist", "liked")
        created_at: creation timestamp (defaults to now)
        updated_at: optional last modification timestamp

    returns:
        record dict ready for ATProto
    """
    record: dict[str, Any] = {
        "$type": settings.atproto.list_collection,
        "items": [
            {"subject": {"uri": item["uri"], "cid": item["cid"]}} for item in items
        ],
        "createdAt": (created_at or datetime.now(UTC))
        .isoformat()
        .replace("+00:00", "Z"),
    }

    if name:
        record["name"] = name
    if list_type:
        record["listType"] = list_type
    if updated_at:
        record["updatedAt"] = updated_at.isoformat().replace("+00:00", "Z")

    return record


async def create_list_record(
    auth_session: AuthSession,
    items: list[dict[str, str]],
    name: str | None = None,
    list_type: str | None = None,
) -> tuple[str, str]:
    """Create a list record on the user's PDS.

    args:
        auth_session: authenticated user session
        items: list of record references, each with {"uri": str, "cid": str}
        name: optional display name
        list_type: optional semantic type (e.g., "album", "playlist", "liked")

    returns:
        tuple of (record_uri, record_cid)
    """
    record = build_list_record(items=items, name=name, list_type=list_type)

    payload = {
        "repo": auth_session.did,
        "collection": settings.atproto.list_collection,
        "record": record,
    }

    result = await _make_pds_request(
        auth_session, "POST", "com.atproto.repo.createRecord", payload
    )
    return result["uri"], result["cid"]


async def update_list_record(
    auth_session: AuthSession,
    list_uri: str,
    items: list[dict[str, str]],
    name: str | None = None,
    list_type: str | None = None,
    created_at: datetime | None = None,
) -> tuple[str, str]:
    """Update an existing list record on the user's PDS.

    args:
        auth_session: authenticated user session
        list_uri: AT URI of the list record to update
        items: list of record references (array order = display order)
        name: optional display name
        list_type: optional semantic type (e.g., "album", "playlist", "liked")
        created_at: original creation timestamp (preserved on updates)

    returns:
        tuple of (record_uri, new_record_cid)
    """
    record = build_list_record(
        items=items,
        name=name,
        list_type=list_type,
        created_at=created_at,
        updated_at=datetime.now(UTC),
    )

    return await update_record(
        auth_session=auth_session,
        record_uri=list_uri,
        record=record,
    )


async def update_comment_record(
    auth_session: AuthSession,
    comment_uri: str,
    subject_uri: str,
    subject_cid: str,
    text: str,
    timestamp_ms: int,
    created_at: datetime,
    updated_at: datetime,
) -> str:
    """update a timed comment record on the user's PDS.

    args:
        auth_session: authenticated user session
        comment_uri: AT URI of the comment record to update
        subject_uri: AT URI of the track being commented on
        subject_cid: CID of the track being commented on
        text: updated comment text content
        timestamp_ms: original playback position in milliseconds
        created_at: original creation timestamp
        updated_at: timestamp of this update

    returns:
        new CID for the updated record

    raises:
        ValueError: if session is invalid
        Exception: if record update fails
    """
    record = {
        "$type": settings.atproto.comment_collection,
        "subject": {
            "uri": subject_uri,
            "cid": subject_cid,
        },
        "text": text,
        "timestampMs": timestamp_ms,
        "createdAt": created_at.isoformat().replace("+00:00", "Z"),
        "updatedAt": updated_at.isoformat().replace("+00:00", "Z"),
    }

    _, new_cid = await update_record(
        auth_session=auth_session,
        record_uri=comment_uri,
        record=record,
    )
    return new_cid


def build_profile_record(
    bio: str | None = None,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> dict[str, Any]:
    """Build a profile record dict for ATProto.

    args:
        bio: artist bio/description
        created_at: creation timestamp (defaults to now)
        updated_at: optional last modification timestamp

    returns:
        record dict ready for ATProto
    """
    record: dict[str, Any] = {
        "$type": settings.atproto.profile_collection,
        "createdAt": (created_at or datetime.now(UTC))
        .isoformat()
        .replace("+00:00", "Z"),
    }

    if bio:
        record["bio"] = bio
    if updated_at:
        record["updatedAt"] = updated_at.isoformat().replace("+00:00", "Z")

    return record


async def upsert_profile_record(
    auth_session: AuthSession,
    bio: str | None = None,
) -> tuple[str, str] | None:
    """Create or update the user's plyr.fm profile record.

    uses putRecord with rkey="self" for upsert semantics - creates if
    doesn't exist, updates if it does. skips write if record already
    exists with the same bio (no-op for unchanged data).

    args:
        auth_session: authenticated user session
        bio: artist bio/description

    returns:
        tuple of (record_uri, record_cid) or None if skipped (unchanged)
    """
    # check if profile already exists to preserve createdAt and skip if unchanged
    existing_created_at = None
    existing_bio = None
    existing_uri = None
    existing_cid = None

    try:
        # try to get existing record
        oauth_data = auth_session.oauth_session
        if oauth_data and "pds_url" in oauth_data:
            oauth_session = _reconstruct_oauth_session(oauth_data)
            url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.getRecord"
            params = {
                "repo": auth_session.did,
                "collection": settings.atproto.profile_collection,
                "rkey": "self",
            }
            response = await get_oauth_client().make_authenticated_request(
                session=oauth_session,
                method="GET",
                url=url,
                params=params,
            )
            if response.status_code == 200:
                existing = response.json()
                existing_uri = existing.get("uri")
                existing_cid = existing.get("cid")
                if "value" in existing:
                    existing_bio = existing["value"].get("bio")
                    if "createdAt" in existing["value"]:
                        existing_created_at = datetime.fromisoformat(
                            existing["value"]["createdAt"].replace("Z", "+00:00")
                        )
    except Exception:
        # record doesn't exist yet, that's fine
        pass

    # skip write if record exists with same bio (no changes needed)
    if existing_uri and existing_cid and existing_bio == bio:
        return None

    record = build_profile_record(
        bio=bio,
        created_at=existing_created_at,
        updated_at=datetime.now(UTC) if existing_created_at else None,
    )

    payload = {
        "repo": auth_session.did,
        "collection": settings.atproto.profile_collection,
        "rkey": "self",
        "record": record,
    }

    result = await _make_pds_request(
        auth_session, "POST", "com.atproto.repo.putRecord", payload
    )
    return result["uri"], result["cid"]


async def upsert_album_list_record(
    auth_session: AuthSession,
    album_id: str,
    album_title: str,
    track_refs: list[dict[str, str]],
    existing_uri: str | None = None,
    existing_created_at: datetime | None = None,
) -> tuple[str, str] | None:
    """Create or update an album as a list record.

    args:
        auth_session: authenticated user session
        album_id: internal album ID (for logging)
        album_title: album display name
        track_refs: list of track references [{"uri": str, "cid": str}, ...]
        existing_uri: existing ATProto record URI if updating
        existing_created_at: original creation timestamp to preserve

    returns:
        tuple of (record_uri, record_cid) or None if no tracks to sync
    """
    if not track_refs:
        logger.debug(f"album {album_id} has no tracks with ATProto records, skipping")
        return None

    if existing_uri:
        # update existing record
        uri, cid = await update_list_record(
            auth_session=auth_session,
            list_uri=existing_uri,
            items=track_refs,
            name=album_title,
            list_type="album",
            created_at=existing_created_at,
        )
        logger.info(f"updated album list record for {album_id}: {uri}")
        return uri, cid
    else:
        # create new record
        uri, cid = await create_list_record(
            auth_session=auth_session,
            items=track_refs,
            name=album_title,
            list_type="album",
        )
        logger.info(f"created album list record for {album_id}: {uri}")
        return uri, cid


async def upsert_liked_list_record(
    auth_session: AuthSession,
    track_refs: list[dict[str, str]],
    existing_uri: str | None = None,
    existing_created_at: datetime | None = None,
) -> tuple[str, str] | None:
    """Create or update the user's liked tracks list record.

    args:
        auth_session: authenticated user session
        track_refs: list of liked track references [{"uri": str, "cid": str}, ...]
        existing_uri: existing ATProto record URI if updating
        existing_created_at: original creation timestamp to preserve

    returns:
        tuple of (record_uri, record_cid) or None if no likes to sync
    """
    if not track_refs:
        logger.debug(f"user {auth_session.did} has no liked tracks to sync")
        return None

    if existing_uri:
        # update existing record
        uri, cid = await update_list_record(
            auth_session=auth_session,
            list_uri=existing_uri,
            items=track_refs,
            name="Liked Tracks",
            list_type="liked",
            created_at=existing_created_at,
        )
        logger.info(f"updated liked list record for {auth_session.did}: {uri}")
        return uri, cid
    else:
        # create new record
        uri, cid = await create_list_record(
            auth_session=auth_session,
            items=track_refs,
            name="Liked Tracks",
            list_type="liked",
        )
        logger.info(f"created liked list record for {auth_session.did}: {uri}")
        return uri, cid
