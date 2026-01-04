"""low-level ATProto PDS client with OAuth and token refresh."""

import asyncio
import json
import logging
from typing import Any

from atproto_oauth.models import OAuthSession
from cachetools import LRUCache

from backend._internal import Session as AuthSession
from backend._internal import get_oauth_client, get_session, update_session_tokens

logger = logging.getLogger(__name__)

# per-session locks for token refresh to prevent concurrent refresh races.
# uses LRUCache (not TTLCache) to bound memory - LRU eviction is safe because:
# 1. recently-used locks won't be evicted while in use
# 2. TTL expiration could evict a lock while a coroutine holds it, breaking mutual exclusion
_refresh_locks: LRUCache[str, asyncio.Lock] = LRUCache(maxsize=10_000)


def reconstruct_oauth_session(oauth_data: dict[str, Any]) -> OAuthSession:
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

        current_oauth_session = reconstruct_oauth_session(updated_oauth_data)

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
                retry_oauth_session = reconstruct_oauth_session(
                    retry_session.oauth_session
                )
                if retry_oauth_session.access_token != oauth_session.access_token:
                    logger.info(
                        f"using tokens refreshed by parallel request for {auth_session.did}"
                    )
                    return retry_oauth_session

            raise ValueError(f"failed to refresh access token: {e}") from e


async def make_pds_request(
    auth_session: AuthSession,
    method: str,
    endpoint: str,
    payload: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
    success_codes: tuple[int, ...] = (200, 201),
) -> dict[str, Any]:
    """make an authenticated request to the PDS with automatic token refresh.

    args:
        auth_session: authenticated user session
        method: HTTP method (POST, GET, etc.)
        endpoint: XRPC endpoint (e.g., "com.atproto.repo.createRecord")
        payload: request JSON payload (for POST)
        params: query parameters (for GET)
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

    oauth_session = reconstruct_oauth_session(oauth_data)
    url = f"{oauth_data['pds_url']}/xrpc/{endpoint}"

    for attempt in range(2):
        kwargs: dict[str, Any] = {}
        if payload:
            kwargs["json"] = payload
        if params:
            kwargs["params"] = params

        response = await get_oauth_client().make_authenticated_request(
            session=oauth_session,
            method=method,
            url=url,
            **kwargs,
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


def parse_at_uri(uri: str) -> tuple[str, str, str]:
    """parse an AT URI into (repo, collection, rkey)."""
    if not uri.startswith("at://"):
        raise ValueError(f"Invalid AT URI format: {uri}")
    parts = uri.replace("at://", "").split("/")
    if len(parts) != 3:
        raise ValueError(f"Invalid AT URI structure: {uri}")
    return parts[0], parts[1], parts[2]
