"""Exchange token creation and consumption."""

import base64
import hashlib
import secrets
from datetime import UTC, datetime

from sqlalchemy import select, update

from backend.models import ExchangeToken
from backend.utilities.database import db_session


def pkce_challenge(code_verifier: str) -> str:
    """the S256 challenge for a PKCE verifier (RFC 7636)."""
    digest = hashlib.sha256(code_verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


async def create_exchange_token(
    session_id: str, is_dev_token: bool = False, code_challenge: str | None = None
) -> str:
    """create a one-time use exchange token for secure OAuth callback.

    exchange tokens expire after 60 seconds and can only be used once,
    preventing session_id exposure in browser history/referrers.

    args:
        session_id: the session to associate with this exchange token
        is_dev_token: if True, the exchange will not set a browser cookie
        code_challenge: S256 PKCE challenge from a native app. the exchange then
            requires the matching verifier, so the token alone is not enough
    """
    token = secrets.token_urlsafe(32)

    async with db_session() as db:
        exchange_token = ExchangeToken(
            token=token,
            session_id=session_id,
            is_dev_token=is_dev_token,
            code_challenge=code_challenge,
        )
        db.add(exchange_token)
        await db.commit()

    return token


async def consume_exchange_token(
    token: str, code_verifier: str | None = None
) -> tuple[str, bool] | None:
    """consume an exchange token and return (session_id, skip_cookie).

    skip_cookie is True for dev tokens and native app sign-ins, which carry the
    session id as a bearer token instead of a browser cookie.

    returns None if token is invalid, expired, already used, or bound to a PKCE
    challenge that code_verifier does not match.
    uses atomic UPDATE to prevent race conditions (token can only be used once).
    """
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

        challenge = exchange_token.code_challenge
        if challenge and not (
            code_verifier
            and secrets.compare_digest(pkce_challenge(code_verifier), challenge)
        ):
            return None

        skip_cookie = exchange_token.is_dev_token or challenge is not None

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
        if session_id is None:
            return None

        return session_id, skip_cookie
