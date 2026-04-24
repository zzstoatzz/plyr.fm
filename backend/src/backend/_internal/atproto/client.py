"""low-level ATProto PDS client with OAuth and token refresh."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any, BinaryIO

import httpcore
import httpx
from atproto import AtUri
from atproto_oauth.models import OAuthSession
from cachetools import LRUCache

from backend._internal import Session as AuthSession
from backend._internal import get_oauth_client, get_session, update_session_tokens
from backend._internal.auth import (
    get_client_auth_method,
    get_refresh_token_lifetime_days,
)

logger = logging.getLogger(__name__)


def pds_blob_url(pds_url: str, did: str, cid: str) -> str:
    """construct a public URL to fetch a blob from a PDS."""
    return f"{pds_url}/xrpc/com.atproto.sync.getBlob?did={did}&cid={cid}"


def _describe_exc(e: BaseException) -> str:
    """produce a non-empty, type-qualified description of an exception.

    some exception types (notably httpx.RemoteProtocolError with an empty
    h11 reason, asyncio.CancelledError, and bare HTTPError subclasses)
    stringify to "", which makes downstream error logs and user-visible
    messages useless. always surface the exception type; fall back to the
    repr if str is empty.
    """
    msg = str(e)
    if msg:
        return f"{type(e).__name__}: {msg}"
    return f"{type(e).__name__}: {e!r}" if repr(e) else type(e).__name__


# httpx / httpcore exception classes we treat as transient and retry on
# before giving up. covers connection drops, read-half failures,
# protocol-level errors (remote closed before fully responding),
# timeouts, and pool exhaustion.
_TRANSIENT_HTTP_ERRORS: tuple[type[BaseException], ...] = (
    httpx.ReadError,
    httpx.ConnectError,
    httpx.RemoteProtocolError,
    httpx.TimeoutException,
    httpx.PoolTimeout,
    httpcore.ReadError,
    httpcore.ConnectError,
    httpcore.RemoteProtocolError,
)

# max attempts for a single PDS request (including the initial try).
# backoff schedule between attempts: element N is the sleep BEFORE
# attempt N+1 runs. 4 attempts with 1s/2s/4s gives exponential-ish
# backoff that totals ~7s of deliberate sleep across all retries,
# on top of whatever time the underlying connect/read took.
_PDS_MAX_ATTEMPTS = 4
_PDS_BACKOFF_SCHEDULE: tuple[float, ...] = (1.0, 2.0, 4.0)


def _backoff_for_attempt(attempt: int) -> float:
    """seconds to sleep AFTER a failed attempt of index `attempt`."""
    return _PDS_BACKOFF_SCHEDULE[min(attempt, len(_PDS_BACKOFF_SCHEDULE) - 1)]


class PayloadTooLargeError(Exception):
    """raised when PDS rejects a blob due to size limits."""


# BlobRef uses ATProto's JSON structure with $type, $link keys.
# TypedDict can't express $ in field names, so we use dict[str, Any] with documentation.
# Structure: {"$type": "blob", "ref": {"$link": "<CID>"}, "mimeType": str, "size": int}
BlobRef = dict[str, Any]

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
            client_auth_method = get_client_auth_method(updated_oauth_data)
            refresh_lifetime_days = get_refresh_token_lifetime_days(client_auth_method)
            refresh_expires_at = datetime.now(UTC) + timedelta(
                days=refresh_lifetime_days
            )
            updated_session_data["client_auth_method"] = client_auth_method
            updated_session_data["refresh_token_lifetime_days"] = refresh_lifetime_days
            updated_session_data["refresh_token_expires_at"] = (
                refresh_expires_at.isoformat()
            )

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
    response = None  # defensive: bind before the loop so error paths can read it
    has_refreshed = False

    for attempt in range(_PDS_MAX_ATTEMPTS):
        kwargs: dict[str, Any] = {}
        if payload:
            kwargs["json"] = payload
        if params:
            kwargs["params"] = params

        try:
            response = await get_oauth_client().make_authenticated_request(
                session=oauth_session,
                method=method,
                url=url,
                **kwargs,
            )
        except _TRANSIENT_HTTP_ERRORS as e:
            if attempt < _PDS_MAX_ATTEMPTS - 1:
                backoff = _backoff_for_attempt(attempt)
                logger.warning(
                    f"PDS network error for {auth_session.did} on attempt "
                    f"{attempt + 1}/{_PDS_MAX_ATTEMPTS}, backing off {backoff}s: "
                    f"{_describe_exc(e)}"
                )
                await asyncio.sleep(backoff)
                continue
            raise Exception(
                f"PDS request failed after {_PDS_MAX_ATTEMPTS} attempts: {_describe_exc(e)}"
            ) from e

        if response.status_code in success_codes:
            if response.status_code == 204:
                return {}
            return response.json()

        # 401: token expired or rejected. always attempt refresh on the first
        # 401 we see (under concurrent load PDSes return 401 bodies with
        # varying shapes, including empty — gating on "exp" in the message
        # silently skipped refresh before). if the refresh itself is flaky,
        # retry it once before giving up.
        if response.status_code == 401 and not has_refreshed:
            has_refreshed = True
            logger.info(
                f"access token expired or rejected for {auth_session.did}; refreshing"
            )
            try:
                oauth_session = await _refresh_session_tokens(
                    auth_session, oauth_session
                )
            except _TRANSIENT_HTTP_ERRORS as refresh_exc:
                logger.warning(
                    f"token refresh hit transient error, retrying once: {_describe_exc(refresh_exc)}"
                )
                await asyncio.sleep(1)
                oauth_session = await _refresh_session_tokens(
                    auth_session, oauth_session
                )
            continue

        # 5xx: upstream is failing, worth a backoff + retry
        if 500 <= response.status_code < 600 and attempt < _PDS_MAX_ATTEMPTS - 1:
            backoff = _backoff_for_attempt(attempt)
            logger.warning(
                f"PDS {response.status_code} for {auth_session.did} on attempt "
                f"{attempt + 1}/{_PDS_MAX_ATTEMPTS}, backing off {backoff}s"
            )
            await asyncio.sleep(backoff)
            continue

        # 4xx other than 401, or 5xx on the last attempt, or a repeat 401
        # post-refresh: stop retrying and surface the error.
        break

    if response is None:
        raise Exception("PDS request failed: no response received")
    raise Exception(
        f"PDS request failed: {response.status_code} {response.text or '<empty body>'}"
    )


async def upload_blob(
    auth_session: AuthSession,
    data: bytes | BinaryIO,
    content_type: str,
) -> BlobRef:
    """upload a blob to the user's PDS.

    args:
        auth_session: authenticated user session
        data: binary data or file-like object to upload
        content_type: MIME type (e.g., audio/mpeg, audio/wav)

    returns:
        blob reference dict: {"$type": "blob", "ref": {"$link": CID}, "mimeType": str, "size": int}

    raises:
        PayloadTooLargeError: if PDS rejects due to size limit (413)
        ValueError: if session is invalid
        Exception: if upload fails after retry
    """
    oauth_data = auth_session.oauth_session
    if not oauth_data or "access_token" not in oauth_data:
        raise ValueError(
            f"OAuth session data missing or invalid for {auth_session.did}"
        )

    oauth_session = reconstruct_oauth_session(oauth_data)
    url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.uploadBlob"

    # read data if it's a file-like object
    blob_data = data if isinstance(data, bytes) else data.read()

    response = None  # defensive: bind before the loop
    has_refreshed = False

    for attempt in range(_PDS_MAX_ATTEMPTS):
        try:
            response = await get_oauth_client().make_authenticated_request(
                session=oauth_session,
                method="POST",
                url=url,
                content=blob_data,
                headers={"Content-Type": content_type},
            )
        except _TRANSIENT_HTTP_ERRORS as e:
            if attempt < _PDS_MAX_ATTEMPTS - 1:
                backoff = _backoff_for_attempt(attempt)
                logger.warning(
                    f"PDS blob upload network error for {auth_session.did} on "
                    f"attempt {attempt + 1}/{_PDS_MAX_ATTEMPTS}, backing off "
                    f"{backoff}s: {_describe_exc(e)}"
                )
                await asyncio.sleep(backoff)
                continue
            raise Exception(
                f"blob upload failed after {_PDS_MAX_ATTEMPTS} attempts: {_describe_exc(e)}"
            ) from e

        if response.status_code == 200:
            return response.json()["blob"]

        # payload too large - PDS rejects due to size limit
        if response.status_code == 413:
            raise PayloadTooLargeError(
                f"blob too large for PDS (limit exceeded): {response.text or '<empty body>'}"
            )

        # 401: refresh once, then retry (same rationale as make_pds_request).
        if response.status_code == 401 and not has_refreshed:
            has_refreshed = True
            logger.info(
                f"access token expired or rejected for {auth_session.did}; refreshing"
            )
            try:
                oauth_session = await _refresh_session_tokens(
                    auth_session, oauth_session
                )
            except _TRANSIENT_HTTP_ERRORS as refresh_exc:
                logger.warning(
                    f"token refresh hit transient error, retrying once: {_describe_exc(refresh_exc)}"
                )
                await asyncio.sleep(1)
                oauth_session = await _refresh_session_tokens(
                    auth_session, oauth_session
                )
            continue

        # 5xx: backoff and retry
        if 500 <= response.status_code < 600 and attempt < _PDS_MAX_ATTEMPTS - 1:
            backoff = _backoff_for_attempt(attempt)
            logger.warning(
                f"PDS blob upload {response.status_code} for {auth_session.did} "
                f"on attempt {attempt + 1}/{_PDS_MAX_ATTEMPTS}, backing off {backoff}s"
            )
            await asyncio.sleep(backoff)
            continue

        break

    if response is None:
        raise Exception("blob upload failed: no response received")
    raise Exception(
        f"blob upload failed: {response.status_code} {response.text or '<empty body>'}"
    )


def parse_at_uri(uri: str) -> tuple[str, str, str]:
    """parse an AT URI into (repo, collection, rkey).

    thin wrapper around the SDK's AtUri for call-site compatibility.
    """
    parsed = AtUri.from_str(uri)
    return parsed.host, parsed.collection, parsed.rkey
