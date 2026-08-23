"""who may hear an artist's private tracks: the space authority decides, per mint.

the protocol's one commitment is "if you're on the list you can read from the
space", and the only way an app can ask is to request a space credential for
the reader. plyr never stores membership. it holds the answer the authority
gave — a credential, for its own lifetime; a refusal, briefly — and asks again
when that runs out. both expire on their own; neither depends on anything the
artist does in plyr.

two questions, two shapes:
- [can_access][backend._internal.private_access.can_access]: one reader, one
  artist. asks the authority when nothing current is held.
- [held_access][backend._internal.private_access.held_access]: which artists
  a reader currently holds a credential for. never asks; listings use it so a
  feed query does not fan out into credential mints.
"""

import logging
import time

import logfire
from redis.exceptions import RedisError

from backend._internal import Session
from backend._internal.atproto.spaces.client import (
    SpaceAccessError,
    forget_credential,
    get_space_credential,
)
from backend._internal.atproto.spaces.uris import build_space_uri
from backend.config import settings
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

REFUSAL_TTL_SECONDS = 300


def artist_space_uri(artist_did: str) -> str:
    return build_space_uri(
        artist_did, settings.atproto.private_media_space_type, "self"
    )


def _held_key(reader_did: str) -> str:
    return f"private_access:held:{reader_did}"


def _refused_key(reader_did: str, artist_did: str) -> str:
    return f"private_access:refused:{reader_did}:{artist_did}"


async def held_access(reader_did: str | None) -> set[str]:
    """artists whose space ``reader_did`` currently holds a credential for."""
    if reader_did is None:
        return set()
    try:
        redis = get_async_redis_client()
        now = time.time()
        held = await redis.zrangebyscore(_held_key(reader_did), now, "+inf")
    except RedisError:
        logger.debug("held_access: redis unavailable", exc_info=True)
        return set()
    return {m.decode() if isinstance(m, bytes) else m for m in held}


async def _remember_held(reader_did: str, artist_did: str, ttl: float) -> None:
    try:
        redis = get_async_redis_client()
        key = _held_key(reader_did)
        await redis.zadd(key, {artist_did: time.time() + ttl})
        await redis.zremrangebyscore(key, "-inf", time.time())
        seconds = int(ttl) + 1
        if await redis.ttl(key) < 0:
            await redis.expire(key, seconds)
        else:
            await redis.expire(key, seconds, gt=True)
    except RedisError:
        logger.debug("private_access: could not record held credential", exc_info=True)


async def _remember_refused(reader_did: str, artist_did: str) -> None:
    try:
        redis = get_async_redis_client()
        await redis.set(
            _refused_key(reader_did, artist_did), "1", ex=REFUSAL_TTL_SECONDS
        )
    except RedisError:
        logger.debug("private_access: could not record refusal", exc_info=True)


async def _recently_refused(reader_did: str, artist_did: str) -> bool:
    try:
        redis = get_async_redis_client()
        return await redis.exists(_refused_key(reader_did, artist_did)) == 1
    except RedisError:
        return False


async def forget_access(reader_did: str, artist_did: str) -> None:
    """drop what plyr holds for this pair so the next request asks the authority."""
    forget_credential(reader_did, artist_space_uri(artist_did))
    try:
        redis = get_async_redis_client()
        await redis.zrem(_held_key(reader_did), artist_did)
        await redis.delete(_refused_key(reader_did, artist_did))
    except RedisError:
        logger.debug("private_access: could not forget", exc_info=True)


async def can_access(session: Session | None, artist_did: str) -> bool:
    """whether ``session`` may hear ``artist_did``'s private tracks, per the authority.

    the owner always can. anyone else is answered by minting a space credential
    from their own PDS against the artist's space host: success is remembered
    for the credential's lifetime, a refusal for ``REFUSAL_TTL_SECONDS``, and a
    failure to reach either host is not remembered at all — fail closed now,
    ask again next time.
    """
    if session is None:
        return False
    if session.did == artist_did:
        return True
    if artist_did in await held_access(session.did):
        return True
    if await _recently_refused(session.did, artist_did):
        return False
    space = artist_space_uri(artist_did)
    try:
        credential = await get_space_credential(session, space)
    except SpaceAccessError as exc:
        logfire.info(
            "private access refused",
            reader_did=session.did,
            artist_did=artist_did,
            reason=str(exc),
        )
        await _remember_refused(session.did, artist_did)
        return False
    except Exception:
        logger.warning(
            "private access: could not ask the authority for %s", space, exc_info=True
        )
        return False
    ttl = max(credential.expires_at - time.monotonic(), 1.0)
    await _remember_held(session.did, artist_did, ttl)
    return True
