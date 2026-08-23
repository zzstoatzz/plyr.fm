"""private access is answered by the space authority, never by plyr's own state.

plyr holds only what the authority said — a credential for its lifetime, a
refusal briefly — and asks again when that runs out.
"""

import time
from unittest.mock import ANY, AsyncMock, patch

import pytest
import redis.asyncio as async_redis
from atproto_oauth.dpop import DPoPManager

from backend._internal import Session
from backend._internal.atproto.spaces.client import SpaceAccessError, SpaceCredential
from backend._internal.private_access import (
    REFUSAL_TTL_SECONDS,
    artist_space_uri,
    can_access,
    forget_access,
    held_access,
)
from backend.utilities.redis import get_async_redis_client

_ARTIST = "did:test:pa-artist"
_READER = "did:test:pa-reader"


def _session(did: str) -> Session:
    s = Session.__new__(Session)
    s.did = did
    s.handle = "x.test"
    s.session_id = "sess"
    s.oauth_session = {"did": did, "pds_url": "https://test.pds"}
    return s


def _credential(ttl: float = 600.0) -> SpaceCredential:
    return SpaceCredential(
        token="t",
        dpop_key=DPoPManager.generate_keypair(),
        expires_at=time.monotonic() + ttl,
    )


@pytest.fixture(autouse=True)
async def _clean_redis() -> None:
    r: async_redis.Redis = get_async_redis_client()
    async for key in r.scan_iter("private_access:*"):
        await r.delete(key)


def _mint(**kw):
    return patch("backend._internal.private_access.get_space_credential", **kw)


async def test_owner_never_asks():
    with _mint(new=AsyncMock()) as mint:
        assert await can_access(_session(_ARTIST), _ARTIST)
    mint.assert_not_awaited()
    assert not await can_access(None, _ARTIST)


async def test_credential_admits_and_is_held_for_its_lifetime():
    with _mint(return_value=_credential()) as mint:
        assert await can_access(_session(_READER), _ARTIST)
        assert await can_access(_session(_READER), _ARTIST)
    mint.assert_awaited_once_with(ANY, artist_space_uri(_ARTIST), force_refresh=True)
    assert await held_access(_READER) == {_ARTIST}
    assert await held_access("did:test:nobody") == set()


async def test_refusal_denies_and_is_remembered_briefly():
    with _mint(side_effect=SpaceAccessError("UserNotAuthorized")) as mint:
        assert not await can_access(_session(_READER), _ARTIST)
        assert not await can_access(_session(_READER), _ARTIST)
    mint.assert_awaited_once()
    assert await held_access(_READER) == set()
    r: async_redis.Redis = get_async_redis_client()
    ttl = await r.ttl(f"private_access:refused:{_READER}:{_ARTIST}")
    assert 0 < ttl <= REFUSAL_TTL_SECONDS


async def test_unreachable_authority_fails_closed_and_is_not_remembered():
    with _mint(side_effect=RuntimeError("connect timeout")) as mint:
        assert not await can_access(_session(_READER), _ARTIST)
        assert not await can_access(_session(_READER), _ARTIST)
    assert mint.await_count == 2


async def test_forget_access_asks_again():
    with _mint(side_effect=SpaceAccessError("UserNotAuthorized")):
        assert not await can_access(_session(_READER), _ARTIST)
    await forget_access(_READER, _ARTIST)
    with _mint(return_value=_credential()) as mint:
        assert await can_access(_session(_READER), _ARTIST)
    mint.assert_awaited_once()
    await forget_access(_READER, _ARTIST)
    assert await held_access(_READER) == set()


async def test_expired_credential_is_not_held():
    with _mint(return_value=_credential(ttl=0.0)):
        assert await can_access(_session(_READER), _ARTIST)
    r: async_redis.Redis = get_async_redis_client()
    await r.zadd(f"private_access:held:{_READER}", {_ARTIST: time.time() - 1})
    assert await held_access(_READER) == set()
