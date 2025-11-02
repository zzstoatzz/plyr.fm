"""ATProto record creation for relay tracks."""

import json
import logging
from datetime import UTC, datetime
from typing import Any

from atproto_oauth.models import OAuthSession

from relay.auth import Session as AuthSession
from relay.auth import oauth_client, update_session_tokens

logger = logging.getLogger(__name__)


def _reconstruct_oauth_session(oauth_data: dict) -> OAuthSession:
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
    """refresh expired access token using refresh token."""
    logger.info(f"refreshing access token for {auth_session.did}")

    try:
        # use OAuth client to refresh tokens
        refreshed_session = await oauth_client.refresh_session(oauth_session)

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
        update_session_tokens(auth_session.session_id, updated_session_data)

        logger.info(f"successfully refreshed access token for {auth_session.did}")
        return refreshed_session

    except Exception as e:
        logger.error(
            f"failed to refresh token for {auth_session.did}: {e}", exc_info=True
        )
        raise ValueError(f"failed to refresh access token: {e}") from e


async def create_track_record(
    auth_session: AuthSession,
    title: str,
    artist: str,
    audio_url: str,
    file_type: str,
    album: str | None = None,
    duration: int | None = None,
    features: list[dict] | None = None,
) -> tuple[str, str] | None:
    """create app.relay.track record on user's PDS.

    args:
        auth_session: authenticated user session
        title: track title
        artist: artist name
        audio_url: R2 URL for audio file
        file_type: file extension (mp3, wav, etc)
        album: optional album name
        duration: optional duration in seconds
        features: optional list of featured artists [{did, handle, display_name, avatar_url}]

    returns:
        tuple of (record_uri, record_cid)

    raises:
        ValueError: if session is invalid
        Exception: if record creation fails
    """
    # get OAuth session data from database
    oauth_data = auth_session.oauth_session
    if not oauth_data or "access_token" not in oauth_data:
        raise ValueError(
            f"OAuth session data missing or invalid for {auth_session.did}"
        )

    # reconstruct OAuthSession from database
    oauth_session = _reconstruct_oauth_session(oauth_data)

    # construct record
    record: dict[str, Any] = {
        "$type": "app.relay.track",
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

    # make authenticated request to create record
    url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.createRecord"
    payload = {
        "repo": auth_session.did,
        "collection": "app.relay.track",
        "record": record,
    }

    # try creating the record, refresh token if expired
    for attempt in range(2):  # max 2 attempts: initial + 1 retry after refresh
        response = await oauth_client.make_authenticated_request(
            session=oauth_session,
            method="POST",
            url=url,
            json=payload,
        )

        # success
        if response.status_code in (200, 201):
            result = response.json()
            return result["uri"], result["cid"]

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
                    continue  # retry with refreshed token
            except (json.JSONDecodeError, KeyError):
                pass  # not a token expiration error

        # other error or retry failed
        raise Exception(
            f"Failed to create ATProto record: {response.status_code} {response.text}"
        )
