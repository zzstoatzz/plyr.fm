"""low-level ATProto PDS client with OAuth and token refresh."""

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterable, AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, BinaryIO

import httpcore
import httpx
from atproto import AtUri
from atproto_oauth.models import OAuthSession
from atproto_oauth.security import is_safe_url
from cachetools import LRUCache
from redis.exceptions import RedisError

from backend._internal import Session as AuthSession
from backend._internal import get_oauth_client, get_session, update_session_tokens
from backend._internal.auth import (
    get_client_auth_method,
    get_refresh_token_lifetime_days,
)
from backend.utilities.redis import get_async_redis_client

# factory that produces a fresh async iterator over the request body. used
# for streaming uploads where the body must be re-emitted on retry (DPoP
# nonce mismatch, transient network error). the factory is what the caller
# hands us; we never store an iterator ourselves.
StreamBodyFactory = Callable[[], AsyncIterable[bytes]]

# async callable invoked periodically while a streaming body is being sent.
# the streaming POST wrapper throttles calls so a slow uploader doesn't hammer
# whatever the heartbeat writes to. used by the upload pipeline to tick
# `jobs.updated_at` so the stuck-upload reaper trusts liveness signals.
ProgressHeartbeat = Callable[[], Awaitable[None]]

# how often to fire the progress heartbeat while a streaming body is being
# POSTed. 5 seconds gives the reaper 100x headroom over its 10-minute
# threshold; bytes-based fallback at 10 MB catches the case where time hasn't
# elapsed but a lot of data has flowed.
_HEARTBEAT_INTERVAL_SECONDS = 5.0
_HEARTBEAT_INTERVAL_BYTES = 10 * 1024 * 1024


async def _heartbeating_body(
    body_factory: StreamBodyFactory,
    heartbeat: ProgressHeartbeat,
) -> AsyncIterable[bytes]:
    """yield chunks from `body_factory()`, calling `heartbeat()` periodically.

    a thin wrapper that turns a body iterator into a heartbeating iterator
    without the body source needing to know anything about job state.
    throttled by both wall-clock time and byte-count so neither a slow
    trickle nor a fast burst can starve the heartbeat.
    """
    last_beat_time = time.monotonic()
    bytes_since_beat = 0
    async for chunk in body_factory():
        yield chunk
        bytes_since_beat += len(chunk)
        now = time.monotonic()
        if (
            now - last_beat_time >= _HEARTBEAT_INTERVAL_SECONDS
            or bytes_since_beat >= _HEARTBEAT_INTERVAL_BYTES
        ):
            try:
                await heartbeat()
            except Exception:
                logger.exception("heartbeat raised; continuing stream")
            last_beat_time = now
            bytes_since_beat = 0


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


class SessionExpiredError(Exception):
    """raised when an OAuth token refresh fails terminally (the refresh token
    itself is dead — `invalid_grant`). the only remedy is re-authentication, so
    callers/handlers should surface a 401, not a 500. distinct from transient
    refresh failures (network blips), which keep raising ValueError so existing
    retry/catch logic is unaffected.
    """


# BlobRef uses ATProto's JSON structure with $type, $link keys.
# TypedDict can't express $ in field names, so we use dict[str, Any] with documentation.
# Structure: {"$type": "blob", "ref": {"$link": "<CID>"}, "mimeType": str, "size": int}
BlobRef = dict[str, Any]

# per-session locks for token refresh to prevent concurrent refresh races.
# uses LRUCache (not TTLCache) to bound memory - LRU eviction is safe because:
# 1. recently-used locks won't be evicted while in use
# 2. TTL expiration could evict a lock while a coroutine holds it, breaking mutual exclusion
_refresh_locks: LRUCache[str, asyncio.Lock] = LRUCache(maxsize=10_000)

# how long a refresh may hold the lock before it auto-expires, and how long a
# waiter blocks for it. a refresh is a single token-endpoint round-trip (~1-3s);
# this leaves generous headroom without stranding waiters if a holder dies.
_REFRESH_LOCK_TIMEOUT_SECONDS = 15


@contextlib.asynccontextmanager
async def _session_refresh_lock(session_id: str) -> AsyncIterator[None]:
    """serialize a session's token refresh CLUSTER-WIDE via redis.

    the per-process `_refresh_locks` only serializes within one worker — but
    uploads for one artist run across worker processes/machines, so without a
    shared lock each one refreshes on an expired token, rotating the refresh
    token out from under the others (the failure that silently drops blobs to
    R2-only). a redis lock keyed by session collapses them to a single refresh.

    degrades to the in-process lock if redis is unavailable, so refresh never
    breaks outright on a redis blip — single-worker correctness is preserved.
    """
    redis_lock = None
    acquired = False
    try:
        redis_lock = get_async_redis_client().lock(
            f"oauth_refresh:{session_id}",
            timeout=_REFRESH_LOCK_TIMEOUT_SECONDS,
            blocking=True,
            blocking_timeout=_REFRESH_LOCK_TIMEOUT_SECONDS,
        )
        acquired = await redis_lock.acquire()
    except RedisError as exc:
        logger.warning(
            f"redis refresh-lock unavailable for {session_id}, "
            f"falling back to in-process lock: {exc}"
        )
        acquired = False

    if acquired and redis_lock is not None:
        try:
            yield
        finally:
            with contextlib.suppress(Exception):
                await redis_lock.release()
        return

    # fallback: in-process serialization
    proc_lock = _refresh_locks.setdefault(session_id, asyncio.Lock())
    async with proc_lock:
        yield


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

    async with _session_refresh_lock(session_id):
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

            # a dead refresh token (`invalid_grant`) is terminal — the session
            # can't be saved by a retry, the user must sign in again. surface it
            # as a distinct type so handlers return 401 instead of 500.
            if "invalid_grant" in str(e):
                raise SessionExpiredError(
                    "atproto session expired — re-authentication required"
                ) from e
            raise ValueError(f"failed to refresh access token: {e}") from e


async def _refresh_app_password_session(
    auth_session: AuthSession, stale_access_token: str
) -> str:
    """refresh a bearer app-password session via com.atproto.server.refreshSession.

    mirrors _refresh_session_tokens for the app-password path: serialize per
    session, skip the network call if another coroutine already rotated, and
    surface a dead refresh token as SessionExpiredError so handlers return 401.
    """
    from backend._internal.auth.app_password import APP_PASSWORD_REFRESH_DAYS

    session_id = auth_session.session_id
    async with _session_refresh_lock(session_id):
        updated = await get_session(session_id)
        if not updated:
            raise ValueError(f"session {session_id} no longer exists")
        data = updated.oauth_session
        if data.get("access_token") != stale_access_token:
            # another coroutine refreshed while we waited on the lock
            return data["access_token"]

        pds = data["pds_url"].rstrip("/")
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.post(
                f"{pds}/xrpc/com.atproto.server.refreshSession",
                headers={"Authorization": f"Bearer {data['refresh_token']}"},
            )
        if resp.status_code != 200:
            # a dead/expired refresh token is terminal — a fresh app-password
            # login is required. surface it like the OAuth path so handlers 401.
            raise SessionExpiredError(
                "atproto session expired — re-authentication required"
            )

        body = resp.json()
        new_data = {
            **data,
            "access_token": body["accessJwt"],
            "refresh_token": body["refreshJwt"],
            "refresh_token_expires_at": (
                datetime.now(UTC) + timedelta(days=APP_PASSWORD_REFRESH_DAYS)
            ).isoformat(),
        }
        await update_session_tokens(session_id, new_data)
        logger.info("refreshed app-password session for %s", auth_session.did)
        return body["accessJwt"]


async def _app_password_request(
    auth_session: AuthSession,
    method: str,
    endpoint: str,
    payload: dict[str, Any] | None,
    params: dict[str, Any] | None,
    success_codes: tuple[int, ...],
    parse_response: bool,
) -> dict[str, Any]:
    """make_pds_request for bearer app-password sessions (no DPoP/OAuth client)."""
    data = auth_session.oauth_session
    access_token = data["access_token"]
    url = f"{data['pds_url'].rstrip('/')}/xrpc/{endpoint}"
    has_refreshed = False
    response = None

    for attempt in range(_PDS_MAX_ATTEMPTS):
        kwargs: dict[str, Any] = {}
        if payload:
            kwargs["json"] = payload
        if params:
            kwargs["params"] = params
        try:
            async with httpx.AsyncClient(timeout=30) as http:
                response = await http.request(
                    method,
                    url,
                    headers={"Authorization": f"Bearer {access_token}"},
                    **kwargs,
                )
        except _TRANSIENT_HTTP_ERRORS as e:
            if attempt < _PDS_MAX_ATTEMPTS - 1:
                await asyncio.sleep(_backoff_for_attempt(attempt))
                continue
            raise Exception(
                f"PDS request failed after {_PDS_MAX_ATTEMPTS} attempts: {_describe_exc(e)}"
            ) from e

        if response.status_code in success_codes:
            return (
                response.json()
                if parse_response and response.status_code != 204
                else {}
            )

        if response.status_code == 401 and not has_refreshed:
            has_refreshed = True
            access_token = await _refresh_app_password_session(
                auth_session, access_token
            )
            continue

        if 500 <= response.status_code < 600 and attempt < _PDS_MAX_ATTEMPTS - 1:
            await asyncio.sleep(_backoff_for_attempt(attempt))
            continue
        break

    if response is None:
        raise Exception("PDS request failed: no response received")
    raise Exception(
        f"PDS request failed: {response.status_code} {response.text or '<empty body>'}"
    )


async def _app_password_upload_blob(
    auth_session: AuthSession,
    *,
    data: bytes | BinaryIO | None,
    body_factory: StreamBodyFactory | None,
    content_length: int | None,
    content_type: str,
    heartbeat: ProgressHeartbeat | None,
) -> BlobRef:
    """upload_blob for bearer app-password sessions (plain bearer, no DPoP nonce)."""
    sess = auth_session.oauth_session
    access_token = sess["access_token"]
    url = f"{sess['pds_url'].rstrip('/')}/xrpc/com.atproto.repo.uploadBlob"

    blob_data: bytes | None = None
    if body_factory is None:
        assert data is not None
        blob_data = data if isinstance(data, bytes) else data.read()

    response: httpx.Response | None = None
    for attempt in range(_PDS_MAX_ATTEMPTS):
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": content_type,
        }
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(None)) as http:
                if body_factory is not None:
                    assert content_length is not None
                    headers["Content-Length"] = str(content_length)
                    content = (
                        _heartbeating_body(body_factory, heartbeat)
                        if heartbeat is not None
                        else body_factory()
                    )
                    response = await http.post(url, headers=headers, content=content)
                else:
                    response = await http.post(url, headers=headers, content=blob_data)
        except _TRANSIENT_HTTP_ERRORS as e:
            if attempt < _PDS_MAX_ATTEMPTS - 1:
                await asyncio.sleep(_backoff_for_attempt(attempt))
                continue
            raise Exception(
                f"blob upload failed after {_PDS_MAX_ATTEMPTS} attempts: {_describe_exc(e)}"
            ) from e

        if response.status_code == 200:
            return response.json()["blob"]
        if response.status_code == 413:
            raise PayloadTooLargeError(
                f"blob too large for PDS (limit exceeded): {response.text or '<empty body>'}"
            )
        if response.status_code == 401 and attempt < _PDS_MAX_ATTEMPTS - 1:
            access_token = await _refresh_app_password_session(
                auth_session, access_token
            )
            continue
        if 500 <= response.status_code < 600 and attempt < _PDS_MAX_ATTEMPTS - 1:
            await asyncio.sleep(_backoff_for_attempt(attempt))
            continue
        break

    if response is None:
        raise Exception("blob upload failed: no response received")
    raise Exception(
        f"blob upload failed: {response.status_code} {response.text or '<empty body>'}"
    )


async def make_pds_request(
    auth_session: AuthSession,
    method: str,
    endpoint: str,
    payload: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
    success_codes: tuple[int, ...] = (200, 201),
    parse_response: bool = True,
) -> dict[str, Any]:
    """make an authenticated request to the PDS with automatic token refresh.

    args:
        auth_session: authenticated user session
        method: HTTP method (POST, GET, etc.)
        endpoint: XRPC endpoint (e.g., "com.atproto.repo.createRecord")
        payload: request JSON payload (for POST)
        params: query parameters (for GET)
        success_codes: HTTP status codes considered successful
        parse_response: decode successful response JSON; disable when the body
            is not needed

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

    if oauth_data.get("auth_type") == "app_password":
        return await _app_password_request(
            auth_session,
            method,
            endpoint,
            payload,
            params,
            success_codes,
            parse_response,
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
            if response.status_code == 204 or not parse_response:
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


async def _signed_streaming_post(
    oauth_session: OAuthSession,
    url: str,
    body_factory: StreamBodyFactory,
    headers: dict[str, str],
    *,
    heartbeat: ProgressHeartbeat | None = None,
) -> httpx.Response:
    """POST a streaming body to a DPoP-protected URL with nonce retry.

    upstream `OAuthClient.make_authenticated_request` retries internally on
    a DPoP nonce mismatch but reuses the same `kwargs` dict — which means
    an async-iterator body gets exhausted on the first attempt and the
    retry submits an empty body. for streaming uploads we must call the
    factory anew per attempt, so this helper reimplements just the DPoP
    signing + nonce-retry shape.

    `is_safe_url` is mirrored from `make_authenticated_request` so that
    PDS URLs from session storage cannot be redirected to a private
    address by a malicious or malformed session record before we stream
    user audio bytes to them.

    when `heartbeat` is provided, it's invoked periodically as bytes flow
    through the body iterator. used by the upload pipeline to tick
    `jobs.updated_at` so the stuck-upload reaper can trust `updated_at` as
    a real liveness signal even during a long PDS upload (which previously
    had no internal heartbeat between phase-start and phase-end updates).
    """
    if not is_safe_url(url):
        raise ValueError(f"Unsafe URL: {url}")

    client_obj = get_oauth_client()
    # OAuthClient does not expose its DPoP helper on the public surface, but
    # the alternative is reimplementing DPoP proof creation here. an upstream
    # contribution to make `make_authenticated_request` body-factory-aware
    # is the right durable fix; until that lands, borrow `_dpop`.
    dpop = client_obj._dpop
    response: httpx.Response | None = None
    for attempt in range(2):
        proof = dpop.create_proof(
            method="POST",
            url=url,
            private_key=oauth_session.dpop_private_key,
            nonce=oauth_session.dpop_pds_nonce,
            access_token=oauth_session.access_token,
        )
        request_headers = dict(headers)
        request_headers["Authorization"] = f"DPoP {oauth_session.access_token}"
        request_headers["DPoP"] = proof
        # wrap the per-attempt factory so each retry gets a fresh iterator
        # AND a fresh heartbeat throttle state.
        if heartbeat is not None:

            def attempt_body() -> AsyncIterable[bytes]:
                return _heartbeating_body(body_factory, heartbeat)
        else:
            attempt_body = body_factory
        async with httpx.AsyncClient(timeout=httpx.Timeout(None)) as http:
            response = await http.post(
                url, headers=request_headers, content=attempt_body()
            )
        if dpop.is_dpop_nonce_error(response):
            new_nonce = dpop.extract_nonce_from_response(response)
            if new_nonce and attempt == 0:
                oauth_session.dpop_pds_nonce = new_nonce
                await client_obj.session_store.save_session(oauth_session)
                continue
        return response
    assert response is not None
    return response


async def upload_blob(
    auth_session: AuthSession,
    *,
    data: bytes | BinaryIO | None = None,
    body_factory: StreamBodyFactory | None = None,
    content_length: int | None = None,
    content_type: str,
    heartbeat: ProgressHeartbeat | None = None,
) -> BlobRef:
    """upload a blob to the user's PDS.

    callers must pick exactly one of two body shapes:

    - `data`: in-memory bytes or a sync file-like object. correct for
      small blobs (track artwork, profile avatars) where buffering is cheap.
    - `body_factory` + `content_length`: a callable returning a fresh async
      iterator of chunks plus the total byte length. correct for any audio
      blob; never buffers the body in worker memory. the factory is invoked
      per attempt so retries (DPoP nonce, transient network) get a fresh
      stream.

    when `heartbeat` is provided (only meaningful for the streaming branch),
    it's called periodically while the body is being sent so the upload
    pipeline can tick `jobs.updated_at` and keep the stuck-upload reaper
    from racing a legitimately long PDS upload.

    returns:
        blob reference dict: {"$type": "blob", "ref": {"$link": CID}, "mimeType": str, "size": int}

    raises:
        PayloadTooLargeError: if PDS rejects due to size limit (413)
        ValueError: if session is invalid or args are inconsistent
        Exception: if upload fails after retry
    """
    if (data is None) == (body_factory is None):
        raise ValueError("upload_blob requires exactly one of data or body_factory")
    if body_factory is not None and content_length is None:
        raise ValueError("body_factory requires content_length")

    oauth_data = auth_session.oauth_session
    if not oauth_data or "access_token" not in oauth_data:
        raise ValueError(
            f"OAuth session data missing or invalid for {auth_session.did}"
        )

    if oauth_data.get("auth_type") == "app_password":
        return await _app_password_upload_blob(
            auth_session,
            data=data,
            body_factory=body_factory,
            content_length=content_length,
            content_type=content_type,
            heartbeat=heartbeat,
        )

    oauth_session = reconstruct_oauth_session(oauth_data)
    url = f"{oauth_data['pds_url']}/xrpc/com.atproto.repo.uploadBlob"

    # buffered branch: existing small-blob callers pass `data`; we keep the
    # bytes/file-like handling so artwork uploads continue to work unchanged.
    blob_data: bytes | None = None
    if body_factory is None:
        assert data is not None
        blob_data = data if isinstance(data, bytes) else data.read()

    response: httpx.Response | None = None

    for attempt in range(_PDS_MAX_ATTEMPTS):
        try:
            if body_factory is not None:
                assert content_length is not None
                response = await _signed_streaming_post(
                    oauth_session,
                    url,
                    body_factory,
                    headers={
                        "Content-Type": content_type,
                        "Content-Length": str(content_length),
                    },
                    heartbeat=heartbeat,
                )
            else:
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

        # 401: token expired or rotated out from under us by a sibling upload.
        # refresh on EVERY 401 (not once) — under a concurrent rotation herd a
        # single refresh isn't enough: the retry can be 401'd again by another
        # upload's rotation. the redis refresh-lock collapses concurrent
        # refreshes and the reload picks up the latest token; bounded by
        # _PDS_MAX_ATTEMPTS so a genuinely dead token still gives up (and an
        # invalid_grant raises SessionExpiredError, which propagates).
        if response.status_code == 401 and attempt < _PDS_MAX_ATTEMPTS - 1:
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
