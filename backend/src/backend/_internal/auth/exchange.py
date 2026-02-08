"""Exchange token creation and consumption."""

import secrets
from datetime import UTC, datetime

from sqlalchemy import select, update

from backend.models import ExchangeToken
from backend.utilities.database import db_session


async def create_exchange_token(session_id: str, is_dev_token: bool = False) -> str:
    """create a one-time use exchange token for secure OAuth callback.

    exchange tokens expire after 60 seconds and can only be used once,
    preventing session_id exposure in browser history/referrers.

    args:
        session_id: the session to associate with this exchange token
        is_dev_token: if True, the exchange will not set a browser cookie
    """
    token = secrets.token_urlsafe(32)

    async with db_session() as db:
        exchange_token = ExchangeToken(
            token=token,
            session_id=session_id,
            is_dev_token=is_dev_token,
        )
        db.add(exchange_token)
        await db.commit()

    return token


async def consume_exchange_token(token: str) -> tuple[str, bool] | None:
    """consume an exchange token and return (session_id, is_dev_token).

    returns None if token is invalid, expired, or already used.
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

        # capture is_dev_token before atomic update
        is_dev_token = exchange_token.is_dev_token

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

        return session_id, is_dev_token
