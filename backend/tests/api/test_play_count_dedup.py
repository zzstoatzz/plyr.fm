"""regression tests for play-count dedup (issue #1441).

refreshing other tabs while a track is playing used to increment its play count
because each fresh tab re-reported a play from the restored playback position.
the backend now deduplicates one counted play per (listener, track) for roughly
one track-length, while genuine repeat listens after that window still count.
"""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, get_optional_session
from backend.main import app
from backend.models import Artist, Track

_ARTIST_DID = "did:plc:playcount_artist"


class MockSession(Session):
    """minimal session for the authenticated dedup path."""

    def __init__(self, did: str = "did:test:listener") -> None:
        self.did = did
        self.handle = "listener.bsky.social"
        self.session_id = "test_session_id"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": did,
            "handle": "listener.bsky.social",
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": "atproto transition:generic",
            "access_token": "test_token",
            "refresh_token": "test_refresh",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


class _FakeRedis:
    """in-memory stand-in implementing the SET NX EX semantics dedup relies on."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.ex_values: list[int | None] = []

    async def set(
        self, key: str, value: str, nx: bool = False, ex: int | None = None
    ) -> bool | None:
        self.ex_values.append(ex)
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    fake = _FakeRedis()
    monkeypatch.setattr(
        "backend.api.tracks.playback.get_async_redis_client", lambda: fake
    )
    return fake


@pytest.fixture
def authed_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    async def _session() -> Session:
        return MockSession()

    app.dependency_overrides[get_optional_session] = _session
    yield app
    app.dependency_overrides.pop(get_optional_session, None)


@pytest.fixture
def anon_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    async def _session() -> None:
        return None

    app.dependency_overrides[get_optional_session] = _session
    yield app
    app.dependency_overrides.pop(get_optional_session, None)


async def _make_track(
    db_session: AsyncSession, *, suffix: str, duration: int | None
) -> Track:
    artist = await db_session.get(Artist, _ARTIST_DID)
    if artist is None:
        artist = Artist(
            did=_ARTIST_DID, handle="artist.bsky.social", display_name="Artist"
        )
        db_session.add(artist)
        await db_session.flush()
    track = Track(
        title=f"track {suffix}",
        artist_did=_ARTIST_DID,
        file_id=f"file_{suffix}",
        file_type="mp3",
        play_count=0,
        atproto_record_uri=f"at://{_ARTIST_DID}/fm.plyr.track/{suffix}",
        atproto_record_cid=f"cid_{suffix}",
        extra={"duration": duration} if duration is not None else {},
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    return track


def _client(test_app: FastAPI) -> AsyncClient:
    # https base url so the Secure dedup cookie is stored + resent by the jar
    return AsyncClient(transport=ASGITransport(app=test_app), base_url="https://test")


async def test_refresh_does_not_double_count(
    authed_app: FastAPI, db_session: AsyncSession, fake_redis: _FakeRedis
) -> None:
    """the #1441 repro: a second report for the same listener+track is deduped."""
    track = await _make_track(db_session, suffix="dedup", duration=200)

    async with _client(authed_app) as client:
        first = await client.post(f"/tracks/{track.id}/play")
        second = await client.post(f"/tracks/{track.id}/play")

    assert first.json()["play_count"] == 1
    assert second.json()["play_count"] == 1
    # dedup window keyed off the track's duration
    assert fake_redis.ex_values[0] == 200


async def test_replay_after_window_counts_again(
    authed_app: FastAPI, db_session: AsyncSession, fake_redis: _FakeRedis
) -> None:
    """once the dedup key expires, a genuine repeat listen counts."""
    track = await _make_track(db_session, suffix="replay", duration=120)

    async with _client(authed_app) as client:
        first = await client.post(f"/tracks/{track.id}/play")
        fake_redis.store.clear()  # simulate the SET NX key TTL elapsing
        second = await client.post(f"/tracks/{track.id}/play")

    assert first.json()["play_count"] == 1
    assert second.json()["play_count"] == 2


async def test_anonymous_deduped_by_cookie(
    anon_app: FastAPI, db_session: AsyncSession, fake_redis: _FakeRedis
) -> None:
    """anon listeners are deduped via the first-party cookie within one client."""
    track = await _make_track(db_session, suffix="anon", duration=200)

    async with _client(anon_app) as client:
        first = await client.post(f"/tracks/{track.id}/play")
        assert "plyr_play_id" in first.cookies  # cookie minted on first play
        second = await client.post(f"/tracks/{track.id}/play")

    assert first.json()["play_count"] == 1
    assert second.json()["play_count"] == 1


async def test_distinct_anonymous_browsers_each_count(
    anon_app: FastAPI, db_session: AsyncSession, fake_redis: _FakeRedis
) -> None:
    """two cookie-less clients are different listeners and both count."""
    track = await _make_track(db_session, suffix="anon2", duration=200)

    async with _client(anon_app) as a:
        first = await a.post(f"/tracks/{track.id}/play")
    async with _client(anon_app) as b:
        second = await b.post(f"/tracks/{track.id}/play")

    assert first.json()["play_count"] == 1
    assert second.json()["play_count"] == 2


@pytest.mark.parametrize(
    ("duration", "expected_ttl"),
    [(None, 300), (5, 30), (200, 200), (99999, 3600)],
)
async def test_dedup_ttl_clamped_to_track_duration(
    authed_app: FastAPI,
    db_session: AsyncSession,
    fake_redis: _FakeRedis,
    duration: int | None,
    expected_ttl: int,
) -> None:
    track = await _make_track(
        db_session, suffix=f"ttl{duration}", duration=duration
    )

    async with _client(authed_app) as client:
        await client.post(f"/tracks/{track.id}/play")

    assert fake_redis.ex_values[0] == expected_ttl


async def test_counts_when_redis_unavailable(
    authed_app: FastAPI,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """dedup fails open: a redis outage must not block play counting."""
    track = await _make_track(db_session, suffix="failopen", duration=200)

    def boom() -> object:
        raise RuntimeError("redis down")

    monkeypatch.setattr(
        "backend.api.tracks.playback.get_async_redis_client", boom
    )

    async with _client(authed_app) as client:
        first = await client.post(f"/tracks/{track.id}/play")
        second = await client.post(f"/tracks/{track.id}/play")

    assert first.json()["play_count"] == 1
    assert second.json()["play_count"] == 2
