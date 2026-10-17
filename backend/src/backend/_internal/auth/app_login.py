"""Native app sign-in: the scope it may hold and its pending-flow record."""

import re
from datetime import UTC, datetime
from typing import Any

from atproto_oauth.scopes import ScopesSet
from fastapi import HTTPException
from sqlalchemy import select

from backend._internal.auth.session import Session
from backend.config import settings
from backend.models import PendingAppLogin
from backend.utilities.database import db_session

# base64url of a SHA-256 digest, unpadded (RFC 7636 section 4.2)
_S256_CHALLENGE = re.compile(r"^[A-Za-z0-9_-]{43}$")


def is_pkce_challenge(value: str) -> bool:
    """whether value has the shape of an S256 PKCE challenge."""
    return bool(_S256_CHALLENGE.fullmatch(value))


def is_native_app_scope(scope: str) -> bool:
    """whether a scope string lies inside what a native app sign-in may hold.

    the web client always asks for ``blob:*/*`` and repo access, so its grants
    are never a subset of this set. that makes the grant itself the marker of
    an app session, and it survives token refresh without separate bookkeeping.
    """
    tokens = set(scope.split())
    return bool(tokens) and tokens <= set(settings.atproto.native_app_scope.split())


async def save_pending_app_login(state: str, code_challenge: str) -> None:
    """mark an OAuth state as a native app sign-in."""
    async with db_session() as db:
        db.add(PendingAppLogin(state=state, code_challenge=code_challenge))
        await db.commit()


async def get_pending_app_login(state: str) -> str | None:
    """the PKCE challenge for a native app sign-in, or None if state is not one."""
    async with db_session() as db:
        result = await db.execute(
            select(PendingAppLogin).where(PendingAppLogin.state == state)
        )
        pending = result.scalar_one_or_none()
        if not pending:
            return None
        if datetime.now(UTC) > pending.expires_at:
            await db.delete(pending)
            await db.commit()
            return None
        return pending.code_challenge


async def delete_pending_app_login(state: str) -> None:
    """delete a pending native app sign-in after use."""
    async with db_session() as db:
        result = await db.execute(
            select(PendingAppLogin).where(PendingAppLogin.state == state)
        )
        if pending := result.scalar_one_or_none():
            await db.delete(pending)
            await db.commit()


_REPO_WRITE_ACTIONS = {
    "com.atproto.repo.createRecord": ("create",),
    "com.atproto.repo.putRecord": ("create", "update"),
    "com.atproto.repo.deleteRecord": ("delete",),
}
_APPLY_WRITES_ACTIONS = {
    "com.atproto.repo.applyWrites#create": "create",
    "com.atproto.repo.applyWrites#update": "update",
    "com.atproto.repo.applyWrites#delete": "delete",
}


def _repo_writes(
    endpoint: str, payload: dict[str, Any] | None
) -> list[tuple[str, str]]:
    """the (collection, action) pairs a repo write endpoint is about to perform."""
    payload = payload or {}
    if actions := _REPO_WRITE_ACTIONS.get(endpoint):
        return [(payload.get("collection", ""), action) for action in actions]
    if endpoint == "com.atproto.repo.applyWrites":
        return [
            (
                write.get("collection", ""),
                _APPLY_WRITES_ACTIONS.get(write.get("$type"), "create"),
            )
            for write in payload.get("writes", [])
        ]
    return []


def refuse_write_outside_grant(
    session: Session, endpoint: str, payload: dict[str, Any] | None = None
) -> None:
    """refuse a repo write that a native app session's grant does not cover.

    a native app session starts from identity alone, so the write would only
    come back from the PDS as an opaque 4xx. refusing here gives the client the
    same `scope_upgrade_required` it already knows how to act on. web sessions
    are checked against the web baseline in `require_auth` and skip this.
    """
    granted = session.oauth_session.get("scope", "")
    if not is_native_app_scope(granted):
        return

    scopes = ScopesSet.from_string(granted)
    if endpoint == "com.atproto.repo.uploadBlob":
        covered = any(token.startswith("blob") for token in granted.split())
    else:
        covered = all(
            scopes.matches("repo", collection=collection, action=action)
            for collection, action in _repo_writes(endpoint, payload)
        )
    if not covered:
        raise HTTPException(status_code=403, detail="scope_upgrade_required")
