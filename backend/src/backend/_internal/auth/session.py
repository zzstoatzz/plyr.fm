"""Session dataclass, CRUD, token update, and teal check."""

import json
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select

from backend._internal.auth.encryption import _decrypt_data, _encrypt_data
from backend.config import settings
from backend.models import UserPreferences, UserSession
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)

PUBLIC_REFRESH_TOKEN_DAYS = 14
CONFIDENTIAL_REFRESH_TOKEN_DAYS = 180


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


def is_confidential_client() -> bool:
    """check if confidential OAuth client is configured."""
    return bool(settings.atproto.oauth_jwk)


def get_client_auth_method(oauth_session_data: dict[str, Any] | None = None) -> str:
    """resolve client auth method for a session."""
    if oauth_session_data:
        method = oauth_session_data.get("client_auth_method")
        if method in {"public", "confidential"}:
            return method
    return "confidential" if is_confidential_client() else "public"


def get_refresh_token_lifetime_days(client_auth_method: str | None) -> int:
    """get expected refresh token lifetime in days."""
    method = client_auth_method or get_client_auth_method()
    return (
        CONFIDENTIAL_REFRESH_TOKEN_DAYS
        if method == "confidential"
        else PUBLIC_REFRESH_TOKEN_DAYS
    )


def _compute_refresh_token_expires_at(
    now: datetime, client_auth_method: str | None
) -> datetime:
    """compute refresh token expiration time."""
    return now + timedelta(days=get_refresh_token_lifetime_days(client_auth_method))


def _parse_datetime(value: str | None) -> datetime | None:
    """parse ISO datetime string safely."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _get_refresh_token_expires_at(
    user_session: UserSession,
    oauth_session_data: dict[str, Any],
) -> datetime | None:
    """determine refresh token expiry for a session."""
    parsed = _parse_datetime(oauth_session_data.get("refresh_token_expires_at"))
    if parsed:
        return parsed

    client_auth_method = oauth_session_data.get("client_auth_method")
    if client_auth_method:
        return user_session.created_at + timedelta(
            days=get_refresh_token_lifetime_days(client_auth_method)
        )

    if user_session.is_developer_token:
        return user_session.created_at + timedelta(days=PUBLIC_REFRESH_TOKEN_DAYS)

    return None


async def create_session(
    did: str,
    handle: str,
    oauth_session: dict[str, Any],
    expires_in_days: int = 14,
    is_developer_token: bool = False,
    token_name: str | None = None,
    group_id: str | None = None,
) -> str:
    """create a new session for authenticated user with encrypted OAuth data.

    args:
        did: user's decentralized identifier
        handle: user's ATProto handle
        oauth_session: OAuth session data to encrypt and store
        expires_in_days: session expiration in days (default 14, capped by refresh lifetime)
        is_developer_token: whether this is a developer token (for listing/revocation)
        token_name: optional name for the token (only for developer tokens)
        group_id: optional session group ID for multi-account support
    """
    session_id = secrets.token_urlsafe(32)
    now = datetime.now(UTC)

    client_auth_method = get_client_auth_method(oauth_session)
    refresh_lifetime_days = get_refresh_token_lifetime_days(client_auth_method)
    refresh_expires_at = _compute_refresh_token_expires_at(now, client_auth_method)

    oauth_session = dict(oauth_session)
    oauth_session.setdefault("client_auth_method", client_auth_method)
    oauth_session.setdefault("refresh_token_lifetime_days", refresh_lifetime_days)
    oauth_session.setdefault("refresh_token_expires_at", refresh_expires_at.isoformat())

    effective_days = (
        refresh_lifetime_days
        if expires_in_days <= 0
        else min(expires_in_days, refresh_lifetime_days)
    )
    expires_at = now + timedelta(days=effective_days)

    encrypted_data = _encrypt_data(json.dumps(oauth_session))

    async with db_session() as db:
        user_session = UserSession(
            session_id=session_id,
            did=did,
            handle=handle,
            oauth_session_data=encrypted_data,
            expires_at=expires_at,
            is_developer_token=is_developer_token,
            token_name=token_name,
            group_id=group_id,
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

        oauth_session_data = json.loads(decrypted_data)

        refresh_expires_at = _get_refresh_token_expires_at(
            user_session, oauth_session_data
        )
        if refresh_expires_at and datetime.now(UTC) > refresh_expires_at:
            await delete_session(session_id)
            return None

        return Session(
            session_id=user_session.session_id,
            did=user_session.did,
            handle=user_session.handle,
            oauth_session=oauth_session_data,
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


async def _check_teal_preference(did: str) -> bool:
    """check if user has enabled teal.fm scrobbling."""
    async with db_session() as db:
        result = await db.execute(
            select(UserPreferences.enable_teal_scrobbling).where(
                UserPreferences.did == did
            )
        )
        pref = result.scalar_one_or_none()
        return pref is True
