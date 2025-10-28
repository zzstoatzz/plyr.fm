"""OAuth 2.1 authentication and session management."""

import secrets
from dataclasses import dataclass
from typing import Annotated

from atproto_oauth import OAuthClient
from atproto_oauth.stores.memory import MemorySessionStore, MemoryStateStore
from fastapi import Cookie, HTTPException

from relay.config import settings


@dataclass
class Session:
    """authenticated user session."""

    session_id: str
    did: str
    handle: str
    oauth_session: dict  # store OAuth session data


# in-memory stores (MVP - replace with redis/db later)
_sessions: dict[str, Session] = {}
_state_store = MemoryStateStore()
_session_store = MemorySessionStore()

# OAuth client
oauth_client = OAuthClient(
    client_id=settings.atproto_client_id,
    redirect_uri=settings.atproto_redirect_uri,
    scope="atproto",
    state_store=_state_store,
    session_store=_session_store,
)


def create_session(did: str, handle: str, oauth_session: dict) -> str:
    """create a new session for authenticated user."""
    session_id = secrets.token_urlsafe(32)
    _sessions[session_id] = Session(
        session_id=session_id,
        did=did,
        handle=handle,
        oauth_session=oauth_session,
    )
    return session_id


def get_session(session_id: str) -> Session | None:
    """retrieve session by id."""
    return _sessions.get(session_id)


def delete_session(session_id: str) -> None:
    """delete a session."""
    _sessions.pop(session_id, None)


async def start_oauth_flow(handle: str) -> tuple[str, str]:
    """start OAuth flow and return (auth_url, state)."""
    try:
        auth_url, state = await oauth_client.start_authorization(handle)
        return auth_url, state
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"failed to start OAuth flow: {e}",
        ) from e


async def handle_oauth_callback(code: str, state: str, iss: str) -> tuple[str, str, dict]:
    """handle OAuth callback and return (did, handle, oauth_session)."""
    try:
        oauth_session = await oauth_client.handle_callback(
            code=code,
            state=state,
            iss=iss,
        )
        # OAuth session is already stored in session_store, just extract key info
        session_data = {
            "did": oauth_session.did,
            "handle": oauth_session.handle,
            "pds_url": oauth_session.pds_url,
            "authserver_iss": oauth_session.authserver_iss,
            "scope": oauth_session.scope,
        }
        return oauth_session.did, oauth_session.handle, session_data
    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail=f"OAuth callback failed: {e}",
        ) from e


def require_auth(
    session_id: Annotated[str | None, Cookie()] = None,
) -> Session:
    """fastapi dependency to require authentication."""
    if not session_id:
        raise HTTPException(
            status_code=401,
            detail="not authenticated - login required",
        )

    session = get_session(session_id)
    if not session:
        raise HTTPException(
            status_code=401,
            detail="invalid or expired session",
        )

    return session
