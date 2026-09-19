"""shared cache of the DPoP nonce each PDS last issued.

A PDS hands out one nonce for the whole server and rotates it every few
minutes, so the value learned by any request is the right value for the
next request to that host, from any process. Sessions are rebuilt from the
database on every request and only carry the nonce from sign-in, so
without this cache every PDS write pays a 401 round trip first.
"""

import logging
from urllib.parse import urlsplit

import httpx
from atproto_oauth.dpop import DPoPManager
from atproto_oauth.models import OAuthSession
from atproto_oauth.stores.memory import MemorySessionStore
from redis.exceptions import RedisError

from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

PDS_NONCE_KEY_PREFIX = "dpop_pds_nonce:"
PDS_NONCE_TTL_SECONDS = 600


def _key(pds_url: str) -> str:
    return f"{PDS_NONCE_KEY_PREFIX}{urlsplit(pds_url).netloc.lower()}"


async def get_pds_nonce(pds_url: str) -> str | None:
    try:
        value = await get_async_redis_client().get(_key(pds_url))
    except RedisError as e:
        logger.warning("failed to read pds nonce for %s: %s", pds_url, e)
        return None
    if value is None:
        return None
    return value.decode() if isinstance(value, bytes) else str(value)


async def set_pds_nonce(pds_url: str, nonce: str) -> None:
    if not nonce:
        return
    try:
        await get_async_redis_client().set(
            _key(pds_url), nonce, ex=PDS_NONCE_TTL_SECONDS
        )
    except RedisError as e:
        logger.warning("failed to store pds nonce for %s: %s", pds_url, e)


async def hydrate_pds_nonce(session: OAuthSession) -> OAuthSession:
    """prefer the nonce this PDS issued most recently over the one stored at sign-in."""
    if cached := await get_pds_nonce(session.pds_url):
        session.dpop_pds_nonce = cached
    return session


class PdsNonceSessionStore(MemorySessionStore):
    """the store the OAuth client saves to after a nonce retry; forwards the nonce."""

    async def save_session(self, session: OAuthSession) -> None:
        await super().save_session(session)
        await set_pds_nonce(session.pds_url, session.dpop_pds_nonce or "")


async def remember_pds_nonce(session: OAuthSession, response: httpx.Response) -> bool:
    """keep the nonce a PDS response carries; every signed response has one."""
    nonce = DPoPManager.extract_nonce_from_response(response)
    if not nonce or nonce == session.dpop_pds_nonce:
        return False
    session.dpop_pds_nonce = nonce
    await set_pds_nonce(session.pds_url, nonce)
    return True
