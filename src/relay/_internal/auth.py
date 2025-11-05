"""OAuth 2.1 authentication and session management."""

import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from atproto_oauth import OAuthClient
from atproto_oauth.stores.memory import MemorySessionStore
from cryptography.fernet import Fernet
from fastapi import Header, HTTPException
from sqlalchemy import select

from relay.config import settings
from relay.models import ExchangeToken, UserSession
from relay.stores import PostgresStateStore
from relay.utilities.database import db_session


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


# OAuth stores
# state store: postgres-backed for multi-instance resilience
# session store: in-memory (not used, we use UserSession table instead)
_state_store = PostgresStateStore()
_session_store = MemorySessionStore()

# OAuth client
oauth_client = OAuthClient(
    client_id=settings.atproto.client_id,
    redirect_uri=settings.atproto.redirect_uri,
    scope=settings.atproto.resolved_scope,
    state_store=_state_store,
    session_store=_session_store,
)

# encryption for sensitive OAuth data at rest
# CRITICAL: encryption key must be configured and stable across restarts
# otherwise all sessions become undecipherable after restart
if not settings.atproto.oauth_encryption_key:
    raise RuntimeError(
        "oauth_encryption_key must be configured in settings. "
        "generate one with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
    )

_encryption_key = settings.atproto.oauth_encryption_key.encode()
_fernet = Fernet(_encryption_key)


def _encrypt_data(data: str) -> str:
    """encrypt sensitive data for storage."""
    return _fernet.encrypt(data.encode()).decode()


def _decrypt_data(encrypted: str) -> str | None:
    """decrypt sensitive data from storage.

    returns None if decryption fails (e.g., key changed, data corrupted).
    """
    try:
        return _fernet.decrypt(encrypted.encode()).decode()
    except Exception:
        # decryption failed - likely key mismatch or corrupted data
        return None


async def create_session(did: str, handle: str, oauth_session: dict[str, Any]) -> str:
    """create a new session for authenticated user with encrypted OAuth data."""
    session_id = secrets.token_urlsafe(32)

    # encrypt sensitive OAuth session data before storing
    encrypted_data = _encrypt_data(json.dumps(oauth_session))

    # store in database with expiration (2 weeks from now per OAuth 2.1 requirements)
    expires_at = datetime.now(UTC) + timedelta(days=14)

    async with db_session() as db:
        user_session = UserSession(
            session_id=session_id,
            did=did,
            handle=handle,
            oauth_session_data=encrypted_data,
            expires_at=expires_at,
        )
        db.add(user_session)
        await db.commit()

    return session_id


async def get_session(session_id: str) -> Session | None:
    """retrieve session by id, decrypt OAuth data, and validate expiration."""
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(UserSession.session_id == session_id)
        )
        if not (user_session := result.scalar_one_or_none()):
            return None

        # check if session is expired
        if user_session.expires_at and datetime.now(UTC) > user_session.expires_at:
            # session expired - delete it and return None
            await delete_session(session_id)
            return None

        # decrypt OAuth session data
        decrypted_data = _decrypt_data(user_session.oauth_session_data)
        if decrypted_data is None:
            # decryption failed - session is invalid (key changed or data corrupted)
            # delete the corrupted session
            await delete_session(session_id)
            return None

        return Session(
            session_id=user_session.session_id,
            did=user_session.did,
            handle=user_session.handle,
            oauth_session=json.loads(decrypted_data),
        )


async def update_session_tokens(
    session_id: str, oauth_session_data: dict[str, Any]
) -> None:
    """update OAuth session data for a session (e.g., after token refresh)."""
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(UserSession.session_id == session_id)
        )
        if user_session := result.scalar_one_or_none():
            # encrypt updated OAuth session data
            encrypted_data = _encrypt_data(json.dumps(oauth_session_data))
            user_session.oauth_session_data = encrypted_data
            await db.commit()


async def delete_session(session_id: str) -> None:
    """delete a session."""
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(UserSession.session_id == session_id)
        )
        if user_session := result.scalar_one_or_none():
            await db.delete(user_session)
            await db.commit()


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


async def handle_oauth_callback(
    code: str, state: str, iss: str
) -> tuple[str, str, dict]:
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


async def check_artist_profile_exists(did: str) -> bool:
    """check if artist profile exists for a DID."""
    from relay.models import Artist

    async with db_session() as db:
        result = await db.execute(select(Artist).where(Artist.did == did))
        artist = result.scalar_one_or_none()
        return artist is not None


async def create_exchange_token(session_id: str) -> str:
    """create a one-time use exchange token for secure OAuth callback.

    exchange tokens expire after 60 seconds and can only be used once,
    preventing session_id exposure in browser history/referrers.
    """
    token = secrets.token_urlsafe(32)

    async with db_session() as db:
        exchange_token = ExchangeToken(
            token=token,
            session_id=session_id,
        )
        db.add(exchange_token)
        await db.commit()

    return token


async def consume_exchange_token(token: str) -> str | None:
    """consume an exchange token and return the associated session_id.

    returns None if token is invalid, expired, or already used.
    uses atomic UPDATE to prevent race conditions (token can only be used once).
    """
    from sqlalchemy import update

    async with db_session() as db:
        # first, check if token exists and is not expired
        result = await db.execute(
            select(ExchangeToken).where(ExchangeToken.token == token)
        )
        exchange_token = result.scalar_one_or_none()

        if not exchange_token:
            return None

        # check if expired
        if datetime.now(UTC) > exchange_token.expires_at:
            return None

        # atomically mark as used ONLY if not already used
        # this prevents race conditions where two requests try to use the same token
        result = await db.execute(
            update(ExchangeToken)
            .where(ExchangeToken.token == token, ExchangeToken.used == False)  # noqa: E712
            .values(used=True)
            .returning(ExchangeToken.session_id)
        )
        await db.commit()

        # if no rows were updated, token was already used
        session_id = result.scalar_one_or_none()
        return session_id


async def require_auth(
    authorization: Annotated[str | None, Header()] = None,
) -> Session:
    """fastapi dependency to require authentication with expiration validation.

    requires Authorization header with Bearer token containing session_id.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="not authenticated - login required",
        )

    session_id = authorization.removeprefix("Bearer ")

    session = await get_session(session_id)
    if not session:
        raise HTTPException(
            status_code=401,
            detail="invalid or expired session",
        )

    return session


async def require_artist_profile(
    authorization: Annotated[str | None, Header()] = None,
) -> Session:
    """fastapi dependency to require authentication AND complete artist profile.

    Returns 403 with specific message if artist profile doesn't exist,
    prompting frontend to redirect to profile setup.
    """
    session = await require_auth(authorization)

    # check if artist profile exists
    if not await check_artist_profile_exists(session.did):
        raise HTTPException(
            status_code=403,
            detail="artist_profile_required",
        )

    return session
