"""PDS blob upload must survive repeated 401s under concurrent token rotation.

regression for the silent R2-only fallback (prod): when a batch starts with an
expired access token, every upload 401s and races to refresh; the refresh token
rotates, so a retry can 401 *again*. the upload must keep refreshing (up to the
attempt budget) instead of giving up after one — otherwise the blob never lands
on the PDS and the track silently degrades to R2-only.

also covers the cross-process refresh lock: refreshes are serialized via redis
(not just an in-process asyncio.Lock), so concurrent uploads across workers
collapse to a single refresh instead of a rotation thundering-herd.
"""

from types import SimpleNamespace

import httpx
from redis.exceptions import RedisError

from backend._internal import Session
from backend._internal.atproto import client as c


def _session() -> Session:
    s = Session.__new__(Session)
    s.did = "did:plc:x"
    s.handle = "x.test"
    s.session_id = "sess-123"
    s.oauth_session = {
        "did": "did:plc:x",
        "pds_url": "https://pds.test",
        "access_token": "stale-token",
        "dpop_private_key_pem": "fake",
    }
    return s


def _body_factory():
    async def _gen():
        yield b"x" * 10

    return _gen()


async def test_upload_blob_recovers_from_repeated_401(monkeypatch):
    """401, 401, then 200 — must recover. today's one-shot refresh gives up
    after the first retry still 401s, leaving the track R2-only."""
    attempts = {"n": 0}

    async def fake_streaming_post(
        oauth_session, url, body_factory, headers, heartbeat=None
    ):
        attempts["n"] += 1
        if attempts["n"] < 3:
            return httpx.Response(401, json={"error": "invalid_token"})
        return httpx.Response(
            200,
            json={"blob": {"$type": "blob", "ref": {"$link": "bafkreiok"}, "size": 10}},
        )

    refreshes = {"n": 0}

    async def fake_refresh(auth_session, oauth_session):
        refreshes["n"] += 1
        return oauth_session

    monkeypatch.setattr(c, "_signed_streaming_post", fake_streaming_post)
    monkeypatch.setattr(c, "_refresh_session_tokens", fake_refresh)
    monkeypatch.setattr(
        c, "reconstruct_oauth_session", lambda data: SimpleNamespace(access_token="t")
    )

    blob = await c.upload_blob(
        _session(),
        body_factory=_body_factory,
        content_length=10,
        content_type="audio/wav",
    )
    assert blob["ref"]["$link"] == "bafkreiok"
    # recovered only because it refreshed on the SECOND 401 too
    assert attempts["n"] == 3
    assert refreshes["n"] == 2


async def test_session_refresh_lock_uses_redis(monkeypatch):
    """refreshes serialize on a session-scoped REDIS lock (cluster-wide), not
    just the in-process asyncio.Lock."""
    acquired: list[str] = []

    class FakeLock:
        def __init__(self, name: str) -> None:
            self.name = name

        async def acquire(self) -> bool:
            acquired.append(self.name)
            return True

        async def release(self) -> None:
            pass

    class FakeRedis:
        def lock(self, name: str, **kwargs):
            return FakeLock(name)

    monkeypatch.setattr(c, "get_async_redis_client", lambda: FakeRedis())

    async with c._session_refresh_lock("sess-123"):
        pass

    assert acquired == ["oauth_refresh:sess-123"]


async def test_session_refresh_lock_falls_back_when_redis_down(monkeypatch):
    """redis unavailable must degrade to in-process serialization, not break
    refresh entirely."""

    class DeadRedis:
        def lock(self, name: str, **kwargs):
            raise RedisError("redis down")

    monkeypatch.setattr(c, "get_async_redis_client", lambda: DeadRedis())

    entered = False
    async with c._session_refresh_lock("sess-123"):
        entered = True
    assert entered
