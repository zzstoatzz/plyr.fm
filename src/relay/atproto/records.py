"""ATProto record creation for relay tracks."""

import json
from datetime import datetime, timezone

from atproto_oauth.models import OAuthSession

from relay.auth import Session as AuthSession
from relay.auth import oauth_client


async def create_track_record(
    auth_session: AuthSession,
    title: str,
    artist: str,
    audio_url: str,
    file_type: str,
    album: str | None = None,
    duration: int | None = None,
) -> tuple[str, str]:
    """create app.relay.track record on user's PDS.

    args:
        auth_session: authenticated user session
        title: track title
        artist: artist name
        audio_url: R2 URL for audio file
        file_type: file extension (mp3, wav, etc)
        album: optional album name
        duration: optional duration in seconds

    returns:
        tuple of (record_uri, record_cid)

    raises:
        ValueError: if session is invalid
        Exception: if record creation fails
    """
    # get OAuth session data from database
    oauth_data = auth_session.oauth_session
    if not oauth_data or "access_token" not in oauth_data:
        raise ValueError(f"OAuth session data missing or invalid for {auth_session.did}")

    # reconstruct OAuthSession from database
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import serialization

    # deserialize DPoP private key
    dpop_key_pem = oauth_data.get("dpop_private_key_pem")
    if not dpop_key_pem:
        raise ValueError("DPoP private key not found in session - please log out and log back in")

    dpop_private_key = serialization.load_pem_private_key(
        dpop_key_pem.encode("utf-8"),
        password=None,
        backend=default_backend(),
    )

    oauth_session = OAuthSession(
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

    # construct record
    record = {
        "$type": "app.relay.track",
        "title": title,
        "artist": artist,
        "audioUrl": audio_url,
        "fileType": file_type,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }

    # add optional fields
    if album:
        record["album"] = album
    if duration:
        record["duration"] = duration

    # make authenticated request to create record
    url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.createRecord"
    payload = {
        "repo": auth_session.did,
        "collection": "app.relay.track",
        "record": record,
    }

    response = await oauth_client.make_authenticated_request(
        session=oauth_session,
        method="POST",
        url=url,
        json=payload,
    )

    if response.status_code not in (200, 201):
        raise Exception(
            f"Failed to create ATProto record: {response.status_code} {response.text}"
        )

    result = response.json()
    return result["uri"], result["cid"]
