"""Revoke a session's OAuth grant at its authorization server."""

import asyncio
import logging

from backend._internal.auth.oauth import get_oauth_client
from backend._internal.auth.session import Session

logger = logging.getLogger(__name__)

REVOKE_TIMEOUT_SECONDS = 5


async def revoke_grant(session: Session) -> None:
    """revoke a session's tokens at the PDS, best effort.

    signing out must not depend on a remote server: an unreachable or slow
    authserver is logged and the caller deletes the session regardless.
    app-password sessions hold no OAuth grant to revoke.
    """
    from backend._internal.atproto.client import reconstruct_oauth_session

    if session.oauth_session.get("auth_type") == "app_password":
        return
    try:
        oauth_session = await reconstruct_oauth_session(session.oauth_session)
        await asyncio.wait_for(
            get_oauth_client().revoke_session(oauth_session),
            timeout=REVOKE_TIMEOUT_SECONDS,
        )
    except Exception as e:
        logger.warning(
            "could not revoke grant for %s at sign-out: %s: %s",
            session.did,
            type(e).__name__,
            e,
        )
