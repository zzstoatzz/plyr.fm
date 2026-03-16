"""FastAPI dependencies: require_auth, get_optional_session, require_artist_profile."""

import logging
from typing import Annotated

from fastapi import Cookie, Header, HTTPException
from opentelemetry import trace

from backend._internal.auth.oauth import check_artist_profile_exists
from backend._internal.auth.scopes import check_scope_coverage, get_missing_scopes
from backend._internal.auth.session import Session, get_session
from backend.config import settings

logger = logging.getLogger(__name__)


def _tag_span_with_user(session: Session) -> None:
    """attach user identity to the current OpenTelemetry span."""
    span = trace.get_current_span()
    span.set_attribute("user.did", session.did)
    span.set_attribute("user.handle", session.handle)


async def require_auth(
    authorization: Annotated[str | None, Header()] = None,
    session_id: Annotated[str | None, Cookie(alias="session_id")] = None,
) -> Session:
    """fastapi dependency to require authentication with expiration validation.

    checks cookie first (for browser requests), then falls back to Authorization
    header (for SDK/CLI clients). this enables secure HttpOnly cookies for browsers
    while maintaining bearer token support for API clients.

    also validates that the session's granted scopes cover all currently required
    scopes. if not, returns 403 with "scope_upgrade_required" to prompt re-login.
    """
    session_id_value = None

    if session_id:
        session_id_value = session_id
    elif authorization and authorization.startswith("Bearer "):
        session_id_value = authorization.removeprefix("Bearer ")

    if not session_id_value:
        raise HTTPException(
            status_code=401,
            detail="not authenticated - login required",
        )

    session = await get_session(session_id_value)
    if not session:
        raise HTTPException(
            status_code=401,
            detail="invalid or expired session",
        )

    # check if session has all required scopes
    granted_scope = session.oauth_session.get("scope", "")
    required_scope = settings.atproto.resolved_scope

    if not check_scope_coverage(granted_scope, required_scope):
        missing = get_missing_scopes(granted_scope, required_scope)
        logger.info(
            f"session {session.did} missing scopes: {missing}, prompting re-auth"
        )
        raise HTTPException(
            status_code=403,
            detail="scope_upgrade_required",
        )

    _tag_span_with_user(session)
    return session


async def get_optional_session(
    authorization: Annotated[str | None, Header()] = None,
    session_id: Annotated[str | None, Cookie(alias="session_id")] = None,
) -> Session | None:
    """fastapi dependency to optionally get the current session.

    returns None if not authenticated, otherwise returns the session.
    useful for public endpoints that show additional info for logged-in users.
    """
    session_id_value = None

    if session_id:
        session_id_value = session_id
    elif authorization and authorization.startswith("Bearer "):
        session_id_value = authorization.removeprefix("Bearer ")

    if not session_id_value:
        return None

    if session := await get_session(session_id_value):
        _tag_span_with_user(session)
    return session


async def require_artist_profile(
    authorization: Annotated[str | None, Header()] = None,
    session_id: Annotated[str | None, Cookie(alias="session_id")] = None,
) -> Session:
    """fastapi dependency to require authentication AND complete artist profile.

    Returns 403 with specific message if artist profile doesn't exist,
    prompting frontend to redirect to profile setup.
    """
    session = await require_auth(authorization, session_id)

    # check if artist profile exists
    if not await check_artist_profile_exists(session.did):
        raise HTTPException(
            status_code=403,
            detail="artist_profile_required",
        )

    return session
