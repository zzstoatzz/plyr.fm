"""Developer token management: list, revoke, pending dev token flow."""

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select

from backend._internal.auth.encryption import _decrypt_data
from backend._internal.auth.session import _get_refresh_token_expires_at
from backend.models import PendingDevToken, UserSession
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


@dataclass
class DeveloperToken:
    """developer token metadata (without sensitive session data)."""

    session_id: str
    token_name: str | None
    created_at: datetime
    expires_at: datetime | None


async def list_developer_tokens(did: str) -> list[DeveloperToken]:
    """list all developer tokens for a user."""
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(
                UserSession.did == did,
                UserSession.is_developer_token == True,  # noqa: E712
            )
        )
        sessions = result.scalars().all()

        tokens = []
        now = datetime.now(UTC)
        for session in sessions:
            decrypted_data = _decrypt_data(session.oauth_session_data)
            oauth_session_data = (
                json.loads(decrypted_data) if decrypted_data is not None else {}
            )
            refresh_expires_at = _get_refresh_token_expires_at(
                session, oauth_session_data
            )
            effective_expires_at = session.expires_at
            if refresh_expires_at and (
                effective_expires_at is None
                or refresh_expires_at < effective_expires_at
            ):
                effective_expires_at = refresh_expires_at

            # check if expired
            if effective_expires_at and now > effective_expires_at:
                continue  # skip expired tokens

            tokens.append(
                DeveloperToken(
                    session_id=session.session_id,
                    token_name=session.token_name,
                    created_at=session.created_at,
                    expires_at=effective_expires_at,
                )
            )

        return tokens


async def revoke_developer_token(did: str, session_id: str) -> bool:
    """revoke a developer token. returns True if successful, False if not found."""
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(
                UserSession.session_id == session_id,
                UserSession.did == did,  # ensure user owns this token
                UserSession.is_developer_token == True,  # noqa: E712
            )
        )
        session = result.scalar_one_or_none()

        if not session:
            return False

        await db.delete(session)
        await db.commit()
        return True


@dataclass
class PendingDevTokenData:
    """metadata for a pending developer token OAuth flow."""

    state: str
    did: str
    token_name: str | None
    expires_in_days: int


async def save_pending_dev_token(
    state: str,
    did: str,
    token_name: str | None,
    expires_in_days: int,
) -> None:
    """save pending dev token metadata keyed by OAuth state."""
    async with db_session() as db:
        pending = PendingDevToken(
            state=state,
            did=did,
            token_name=token_name,
            expires_in_days=expires_in_days,
        )
        db.add(pending)
        await db.commit()


async def get_pending_dev_token(state: str) -> PendingDevTokenData | None:
    """get pending dev token metadata by OAuth state."""
    async with db_session() as db:
        result = await db.execute(
            select(PendingDevToken).where(PendingDevToken.state == state)
        )
        pending = result.scalar_one_or_none()

        if not pending:
            return None

        # check if expired
        if datetime.now(UTC) > pending.expires_at:
            await db.delete(pending)
            await db.commit()
            return None

        return PendingDevTokenData(
            state=pending.state,
            did=pending.did,
            token_name=pending.token_name,
            expires_in_days=pending.expires_in_days,
        )


async def delete_pending_dev_token(state: str) -> None:
    """delete pending dev token metadata after use."""
    async with db_session() as db:
        result = await db.execute(
            select(PendingDevToken).where(PendingDevToken.state == state)
        )
        if pending := result.scalar_one_or_none():
            await db.delete(pending)
            await db.commit()
