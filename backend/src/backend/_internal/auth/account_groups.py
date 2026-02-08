"""Multi-account session groups: LinkedAccount, group CRUD, switch, remove, pending add-account."""

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import UserSession
from backend.utilities.database import db_session


@dataclass
class LinkedAccount:
    """account info for account switcher UI."""

    did: str
    handle: str
    session_id: str


async def _get_session_group_impl(
    session_id: str, db: AsyncSession
) -> list[LinkedAccount]:
    """implementation of get_session_group using provided db session."""
    result = await db.execute(
        select(UserSession.group_id).where(UserSession.session_id == session_id)
    )
    group_id = result.scalar_one_or_none()

    if not group_id:
        return []

    result = await db.execute(
        select(UserSession).where(
            UserSession.group_id == group_id,
            UserSession.is_developer_token == False,  # noqa: E712
        )
    )
    sessions = result.scalars().all()

    accounts = []
    for session in sessions:
        if session.expires_at and datetime.now(UTC) > session.expires_at:
            continue

        accounts.append(
            LinkedAccount(
                did=session.did,
                handle=session.handle,
                session_id=session.session_id,
            )
        )

    return accounts


async def get_session_group(
    session_id: str, db: AsyncSession | None = None
) -> list[LinkedAccount]:
    """get all accounts in the same session group.

    returns empty list if session has no group_id (single account).

    args:
        session_id: the session to look up
        db: optional database session to reuse (avoids new connection)
    """
    if db is not None:
        return await _get_session_group_impl(session_id, db)

    async with db_session() as new_db:
        return await _get_session_group_impl(session_id, new_db)


async def get_or_create_group_id(session_id: str) -> str:
    """get existing group_id or create one for this session.

    used when adding a second account to create a group.
    """
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(UserSession.session_id == session_id)
        )
        session = result.scalar_one_or_none()

        if not session:
            raise HTTPException(status_code=404, detail="session not found")

        if session.group_id:
            return session.group_id

        # create new group_id for this session
        group_id = secrets.token_urlsafe(32)
        session.group_id = group_id
        await db.commit()

        return group_id


async def _switch_active_account_impl(
    current_session_id: str, target_session_id: str, db: AsyncSession
) -> str:
    """implementation of switch_active_account using provided db session."""
    result = await db.execute(
        select(UserSession).where(UserSession.session_id == current_session_id)
    )
    current_session = result.scalar_one_or_none()

    if not current_session or not current_session.group_id:
        raise HTTPException(status_code=400, detail="no session group found")

    result = await db.execute(
        select(UserSession).where(UserSession.session_id == target_session_id)
    )
    target_session = result.scalar_one_or_none()

    if not target_session:
        raise HTTPException(status_code=404, detail="target session not found")

    if target_session.group_id != current_session.group_id:
        raise HTTPException(status_code=403, detail="target session not in same group")

    if target_session.expires_at and datetime.now(UTC) > target_session.expires_at:
        raise HTTPException(status_code=401, detail="target session expired")

    return target_session_id


async def switch_active_account(
    current_session_id: str, target_session_id: str, db: AsyncSession | None = None
) -> str:
    """switch to a different account within a session group.

    validates that the target session exists, is in the same group, and isn't expired.
    returns the target session_id (caller updates the cookie).

    args:
        current_session_id: the current session
        target_session_id: the session to switch to
        db: optional database session to reuse (avoids new connection)
    """
    if db is not None:
        return await _switch_active_account_impl(
            current_session_id, target_session_id, db
        )

    async with db_session() as new_db:
        return await _switch_active_account_impl(
            current_session_id, target_session_id, new_db
        )


async def remove_account_from_group(session_id: str) -> str | None:
    """remove a session from its group and delete it.

    returns session_id of another account in the group, or None if last account.
    """
    async with db_session() as db:
        result = await db.execute(
            select(UserSession).where(UserSession.session_id == session_id)
        )
        session = result.scalar_one_or_none()

        if not session:
            return None

        group_id = session.group_id

        await db.delete(session)
        await db.commit()

        if not group_id:
            return None

        result = await db.execute(
            select(UserSession).where(
                UserSession.group_id == group_id,
                UserSession.is_developer_token == False,  # noqa: E712
            )
        )
        remaining = result.scalars().first()

        return remaining.session_id if remaining else None


# pending add account flow helpers


@dataclass
class PendingAddAccountData:
    """metadata for a pending add-account OAuth flow."""

    state: str
    group_id: str


async def save_pending_add_account(state: str, group_id: str) -> None:
    """save pending add-account metadata keyed by OAuth state."""
    from backend.models import PendingAddAccount

    async with db_session() as db:
        pending = PendingAddAccount(
            state=state,
            group_id=group_id,
        )
        db.add(pending)
        await db.commit()


async def get_pending_add_account(state: str) -> PendingAddAccountData | None:
    """get pending add-account metadata by OAuth state."""
    from backend.models import PendingAddAccount

    async with db_session() as db:
        result = await db.execute(
            select(PendingAddAccount).where(PendingAddAccount.state == state)
        )
        pending = result.scalar_one_or_none()

        if not pending:
            return None

        # check if expired
        if datetime.now(UTC) > pending.expires_at:
            await db.delete(pending)
            await db.commit()
            return None

        return PendingAddAccountData(
            state=pending.state,
            group_id=pending.group_id,
        )


async def delete_pending_add_account(state: str) -> None:
    """delete pending add-account metadata after use."""
    from backend.models import PendingAddAccount

    async with db_session() as db:
        result = await db.execute(
            select(PendingAddAccount).where(PendingAddAccount.state == state)
        )
        if pending := result.scalar_one_or_none():
            await db.delete(pending)
            await db.commit()


# scope upgrade flow helpers


@dataclass
class PendingScopeUpgradeData:
    """metadata for a pending scope upgrade OAuth flow."""

    state: str
    did: str
    old_session_id: str
    requested_scopes: str


async def save_pending_scope_upgrade(
    state: str,
    did: str,
    old_session_id: str,
    requested_scopes: str,
) -> None:
    """save pending scope upgrade metadata keyed by OAuth state."""
    from backend.models import PendingScopeUpgrade

    async with db_session() as db:
        pending = PendingScopeUpgrade(
            state=state,
            did=did,
            old_session_id=old_session_id,
            requested_scopes=requested_scopes,
        )
        db.add(pending)
        await db.commit()


async def get_pending_scope_upgrade(state: str) -> PendingScopeUpgradeData | None:
    """get pending scope upgrade metadata by OAuth state."""
    from backend.models import PendingScopeUpgrade

    async with db_session() as db:
        result = await db.execute(
            select(PendingScopeUpgrade).where(PendingScopeUpgrade.state == state)
        )
        pending = result.scalar_one_or_none()

        if not pending:
            return None

        # check if expired
        if datetime.now(UTC) > pending.expires_at:
            await db.delete(pending)
            await db.commit()
            return None

        return PendingScopeUpgradeData(
            state=pending.state,
            did=pending.did,
            old_session_id=pending.old_session_id,
            requested_scopes=pending.requested_scopes,
        )


async def delete_pending_scope_upgrade(state: str) -> None:
    """delete pending scope upgrade metadata after use."""
    from backend.models import PendingScopeUpgrade

    async with db_session() as db:
        result = await db.execute(
            select(PendingScopeUpgrade).where(PendingScopeUpgrade.state == state)
        )
        if pending := result.scalar_one_or_none():
            await db.delete(pending)
            await db.commit()
