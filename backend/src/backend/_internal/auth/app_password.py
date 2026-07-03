"""Browserless developer-token minting via an atproto app-password.

The normal developer-token path (`/auth/developer-token/start` → browser OAuth
consent → `/auth/callback`) hard-requires a browser redirect. For CI / test
accounts we instead log in with `com.atproto.server.createSession` (identifier +
app-password) and wrap the returned bearer JWTs into a developer-token session
the PDS write path can use. Gated OFF by default; enable only in dev/staging.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from atproto_oauth.security import is_safe_url

from backend._internal.auth.session import create_session
from backend.config import settings

logger = logging.getLogger(__name__)

# app-password refresh tokens on reference PDSes last ~90 days and rotate on
# use; cap the session to match so it never outlives its refresh token.
APP_PASSWORD_REFRESH_DAYS = 90


class AppPasswordAuthError(Exception):
    """raised when app-password minting is disabled or the PDS login fails."""


async def resolve_pds(handle: str) -> str:
    """resolve a handle to its PDS service endpoint via its DID document.

    lets callers pass just a handle (createSession needs the account's PDS). the
    resolved endpoint is is_safe_url-checked before use so a hostile handle
    cannot point the login at a private address.
    """
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.get(
            "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle",
            params={"handle": handle},
        )
        r.raise_for_status()
        did = r.json()["did"]
        if did.startswith("did:web:"):
            domain = did.removeprefix("did:web:").replace(":", "/")
            doc = (await http.get(f"https://{domain}/.well-known/did.json")).json()
        else:
            doc = (await http.get(f"https://plc.directory/{did}")).json()
    for svc in doc.get("service", []):
        if svc.get("id", "").endswith("atproto_pds"):
            endpoint = svc["serviceEndpoint"]
            if not is_safe_url(endpoint):
                raise AppPasswordAuthError(f"unsafe PDS endpoint for {handle}")
            return endpoint
    raise AppPasswordAuthError(f"no PDS service endpoint in DID document for {handle}")


async def create_app_password_session(
    identifier: str,
    app_password: str,
    pds_url: str,
    *,
    token_name: str | None = None,
    expires_in_days: int = APP_PASSWORD_REFRESH_DAYS,
) -> dict[str, str]:
    """mint a developer-token session from an atproto app-password.

    logs in to `pds_url` via `com.atproto.server.createSession` and persists the
    bearer session as an `is_developer_token` row the write path recognizes by
    its `auth_type: "app_password"` discriminator.

    returns `{"token": session_id, "did": did, "handle": handle}`.

    raises AppPasswordAuthError when disabled by config or the PDS rejects login.
    """
    if not settings.auth.allow_app_password_dev_tokens:
        raise AppPasswordAuthError(
            "app-password developer tokens are disabled "
            "(set AUTH_ALLOW_APP_PASSWORD_DEV_TOKENS=true in dev/staging only)"
        )

    base = pds_url.rstrip("/")
    if not is_safe_url(base):
        raise AppPasswordAuthError(f"unsafe PDS url: {base}")
    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.post(
            f"{base}/xrpc/com.atproto.server.createSession",
            json={"identifier": identifier, "password": app_password},
        )
    if resp.status_code != 200:
        raise AppPasswordAuthError(
            f"createSession failed for {identifier}: "
            f"{resp.status_code} {resp.text or '<empty body>'}"
        )

    body = resp.json()
    did = body["did"]
    handle = body.get("handle", identifier)
    now = datetime.now(UTC)

    oauth_session: dict[str, Any] = {
        "auth_type": "app_password",
        "did": did,
        "handle": handle,
        "pds_url": base,
        "access_token": body["accessJwt"],
        "refresh_token": body["refreshJwt"],
        # explicit so create_session's OAuth-lifetime defaults don't apply
        "refresh_token_expires_at": (
            now + timedelta(days=APP_PASSWORD_REFRESH_DAYS)
        ).isoformat(),
    }

    session_id = await create_session(
        did=did,
        handle=handle,
        oauth_session=oauth_session,
        expires_in_days=expires_in_days,
        is_developer_token=True,
        token_name=token_name,
    )
    logger.info("minted app-password developer token for %s (%s)", handle, did)
    return {"token": session_id, "did": did, "handle": handle}
