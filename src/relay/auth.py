"""OAuth 2.1 authentication and session management."""

import json
import secrets
from dataclasses import dataclass
from typing import Annotated

from atproto_oauth import OAuthClient
from atproto_oauth.stores.memory import MemorySessionStore, MemoryStateStore
from fastapi import Cookie, HTTPException

from relay.config import settings
from relay.models import UserSession, get_db


@dataclass
class Session:
    """authenticated user session."""

    session_id: str
    did: str
    handle: str
    oauth_session: dict  # store OAuth session data

    def get_oauth_session_id(self) -> str:
        """extract OAuth session ID for retrieving from session store."""
        return self.oauth_session.get("session_id", self.did)


# OAuth stores (state store still in-memory for now)
_state_store = MemoryStateStore()
_session_store = MemorySessionStore()

# OAuth client
oauth_client = OAuthClient(
    client_id=settings.atproto_client_id,
    redirect_uri=settings.atproto_redirect_uri,
    scope="atproto repo:app.relay.track",
    state_store=_state_store,
    session_store=_session_store,
)


def create_session(did: str, handle: str, oauth_session: dict) -> str:
    """create a new session for authenticated user."""
    session_id = secrets.token_urlsafe(32)

    # store in database
    db = next(get_db())
    try:
        db_session = UserSession(
            session_id=session_id,
            did=did,
            handle=handle,
            oauth_session_data=json.dumps(oauth_session),
        )
        db.add(db_session)
        db.commit()
    finally:
        db.close()

    return session_id


def get_session(session_id: str) -> Session | None:
    """retrieve session by id."""
    db = next(get_db())
    try:
        db_session = db.query(UserSession).filter(
            UserSession.session_id == session_id
        ).first()

        if not db_session:
            return None

        return Session(
            session_id=db_session.session_id,
            did=db_session.did,
            handle=db_session.handle,
            oauth_session=json.loads(db_session.oauth_session_data),
        )
    finally:
        db.close()


def delete_session(session_id: str) -> None:
    """delete a session."""
    db = next(get_db())
    try:
        db.query(UserSession).filter(
            UserSession.session_id == session_id
        ).delete()
        db.commit()
    finally:
        db.close()


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

        # serialize DPoP private key for storage
        from cryptography.hazmat.primitives import serialization

        dpop_key_pem = oauth_session.dpop_private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("utf-8")

        # store full OAuth session with tokens in database
        session_data = {
            "did": oauth_session.did,
            "handle": oauth_session.handle,
            "pds_url": oauth_session.pds_url,
            "authserver_iss": oauth_session.authserver_iss,
            "scope": oauth_session.scope,
            "access_token": oauth_session.access_token,
            "refresh_token": oauth_session.refresh_token,
            "dpop_private_key_pem": dpop_key_pem,
            "dpop_authserver_nonce": oauth_session.dpop_authserver_nonce,
            "dpop_pds_nonce": oauth_session.dpop_pds_nonce or "",
        }
        return oauth_session.did, oauth_session.handle, session_data
    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail=f"OAuth callback failed: {e}",
        ) from e


from fastapi import Cookie, Header, HTTPException

def require_auth(
    session_id_cookie: Annotated[str | None, Cookie(alias="session_id")] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> Session:
    """fastapi dependency to require authentication.

    Accepts session_id from either:
    - Cookie (for same-domain requests)
    - Authorization header as Bearer token (for cross-domain requests)
    """
    session_id = None

    # try cookie first (for localhost/same-domain)
    if session_id_cookie:
        session_id = session_id_cookie
    # try authorization header (for cross-domain)
    elif authorization and authorization.startswith("Bearer "):
        session_id = authorization.removeprefix("Bearer ")

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
