"""Host Spaces support and the session grants needed for each audio path."""

import httpx
from atproto_oauth.security import is_safe_url
from cachetools import TTLCache
from fastapi import HTTPException

from backend._internal.auth.session import Session as AuthSession
from backend._internal.auth.space_scope import (
    private_media_grant_present,
    private_media_reader_grant_present,
)


def session_has_private_media_access(auth_session: AuthSession) -> bool:
    """whether this session may write to the user's private-media space."""
    data = auth_session.oauth_session or {}
    if data.get("auth_type") == "app_password":
        return True
    return private_media_grant_present(data.get("scope", ""), auth_session.did)


def session_can_read_shared_private_media(auth_session: AuthSession) -> bool:
    """whether this session may read private-media spaces artists shared with it."""
    data = auth_session.oauth_session or {}
    if data.get("auth_type") == "app_password":
        return True
    return private_media_reader_grant_present(data.get("scope", ""))


_capabilities: TTLCache[str, bool] = TTLCache(maxsize=1000, ttl=300)


async def pds_supports_spaces(auth_session: AuthSession) -> bool:
    pds = auth_session.oauth_session.get("pds_url", "").rstrip("/")
    if pds in _capabilities:
        return _capabilities[pds]
    if not pds or not is_safe_url(pds):
        raise HTTPException(
            status_code=503, detail="could not check PDS storage support"
        )
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{pds}/xrpc/com.atproto.server.describeServer")
            response.raise_for_status()
            description = response.json()
            if not isinstance(description, dict):
                raise ValueError("invalid PDS description")
            supported = description.get("spacesAlpha") is True
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=503, detail="could not check PDS storage support"
        ) from exc
    _capabilities[pds] = supported
    return supported


async def protected_storage_choice(auth_session: AuthSession) -> bool:
    if not await pds_supports_spaces(auth_session):
        return False
    if not session_has_protected_audio_access(auth_session):
        raise HTTPException(status_code=403, detail="permissioned_scope_required")
    return True


def session_has_protected_audio_access(auth_session: AuthSession) -> bool:
    data = auth_session.oauth_session or {}
    if data.get("auth_type") == "app_password":
        return True
    return private_media_grant_present(
        data.get("scope", ""), auth_session.did, skey="playback"
    )
