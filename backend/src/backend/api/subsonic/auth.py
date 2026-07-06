"""authenticate subsonic requests against plyr.fm developer tokens.

the subsonic "password" is a plyr.fm developer token. clients can send it
directly via `p` (plain or `enc:`-hex, subsonic legacy auth), or prove
possession via the token scheme: `t` = md5(token + salt `s`) with `u` set to
the account handle or DID. the token scheme requires scanning the user's
developer tokens because the md5 digest can't be reversed to a session id.
"""

import hashlib
from collections.abc import Mapping

from sqlalchemy import or_, select

from backend._internal import Session
from backend._internal.auth.session import get_session
from backend.api.subsonic.responses import (
    ERROR_MISSING_PARAMETER,
    ERROR_WRONG_CREDENTIALS,
    SubsonicError,
)
from backend.models import UserSession
from backend.utilities.database import db_session


async def authenticate(params: Mapping[str, str]) -> Session:
    """resolve subsonic credential params to a plyr.fm session or raise SubsonicError."""

    if password := params.get("p"):
        if session := await get_session(_decode_password(password)):
            return session
        raise SubsonicError(ERROR_WRONG_CREDENTIALS, "wrong username or password")

    username = params.get("u")
    salt = params.get("s")
    digest = params.get("t")
    if username and salt and digest:
        for candidate in await _developer_token_ids(username):
            hashed = hashlib.md5(
                (candidate + salt).encode(), usedforsecurity=False
            ).hexdigest()
            if hashed == digest and (session := await get_session(candidate)):
                return session
        raise SubsonicError(ERROR_WRONG_CREDENTIALS, "wrong username or password")

    raise SubsonicError(
        ERROR_MISSING_PARAMETER, "required parameter is missing: p or u+t+s"
    )


def _decode_password(password: str) -> str:
    if password.startswith("enc:"):
        try:
            return bytes.fromhex(password[4:]).decode()
        except (ValueError, UnicodeDecodeError):
            raise SubsonicError(
                ERROR_WRONG_CREDENTIALS, "wrong username or password"
            ) from None
    return password


async def _developer_token_ids(username: str) -> list[str]:
    """developer token session ids for a handle or DID (token-scheme candidates)."""
    async with db_session() as db:
        result = await db.execute(
            select(UserSession.session_id).where(
                or_(UserSession.handle == username, UserSession.did == username),
                UserSession.is_developer_token == True,  # noqa: E712
            )
        )
        return list(result.scalars().all())
