"""tests for artist leaderboard rank in analytics endpoint."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, require_auth
from backend.api.artists import LEADERBOARD_CACHE_KEY
from backend.main import app
from backend.models import Artist, Track, get_db
from backend.utilities.redis import get_async_redis_client


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:user123"):
        self.did = did
        self.handle = "testuser.bsky.social"
        self.session_id = "test_session_id"
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.oauth_session = {
            "did": did,
            "handle": "testuser.bsky.social",
            "pds_url": "https://test.pds",
            "authserver_iss": "https://auth.test",
            "scope": "atproto transition:generic",
            "access_token": "test_token",
            "refresh_token": "test_refresh",
            "dpop_private_key_pem": "fake_key",
            "dpop_authserver_nonce": "",
            "dpop_pds_nonce": "",
        }


@pytest.fixture
async def _clear_leaderboard_cache():
    """clear leaderboard cache to prevent cross-test pollution."""
    try:
        redis = get_async_redis_client()
        await redis.delete(LEADERBOARD_CACHE_KEY)
    except Exception:
        pass
    yield
    try:
        redis = get_async_redis_client()
        await redis.delete(LEADERBOARD_CACHE_KEY)
    except Exception:
        pass


@pytest.fixture
def test_app(
    db_session: AsyncSession, _clear_leaderboard_cache: None
) -> Generator[FastAPI, None, None]:
    """test app with overridden DB session and cleared leaderboard cache."""

    async def mock_require_auth() -> Session:
        return MockSession()

    async def mock_get_db():
        yield db_session

    app.dependency_overrides[require_auth] = mock_require_auth
    app.dependency_overrides[get_db] = mock_get_db

    yield app

    app.dependency_overrides.clear()


async def test_rank_appears_for_top_artist(test_app: FastAPI, db_session: AsyncSession):
    """artist with the most plays gets rank=1 in analytics."""
    top_artist = Artist(
        did="did:plc:leader1",
        handle="leader.bsky.social",
        display_name="Top Leader",
        pds_url="https://test.pds",
    )
    other_artist = Artist(
        did="did:plc:leader2",
        handle="other.bsky.social",
        display_name="Other Artist",
        pds_url="https://test.pds",
    )
    db_session.add_all([top_artist, other_artist])
    await db_session.flush()

    db_session.add(
        Track(
            title="Hit Song",
            artist_did=top_artist.did,
            file_id="hit1",
            file_type="mp3",
            play_count=200,
        )
    )
    db_session.add(
        Track(
            title="Decent Song",
            artist_did=other_artist.did,
            file_id="decent1",
            file_type="mp3",
            play_count=50,
        )
    )
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        response = await client.get(f"/artists/{top_artist.did}/analytics")

    assert response.status_code == 200
    assert response.json()["rank"] == 1


async def test_rank_ordering_is_correct(test_app: FastAPI, db_session: AsyncSession):
    """artists are ranked by total plays descending."""
    artists_data = [
        ("did:plc:r1", "first.bsky.social", "First", 300),
        ("did:plc:r2", "second.bsky.social", "Second", 200),
        ("did:plc:r3", "third.bsky.social", "Third", 100),
    ]

    for did, handle, name, _plays in artists_data:
        db_session.add(
            Artist(
                did=did,
                handle=handle,
                display_name=name,
                pds_url="https://test.pds",
            )
        )

    await db_session.flush()

    for did, _handle, _name, plays in artists_data:
        db_session.add(
            Track(
                title=f"Track by {did}",
                artist_did=did,
                file_id=f"file_{did}",
                file_type="mp3",
                play_count=plays,
            )
        )

    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        resp = await client.get("/artists/did:plc:r1/analytics")
        assert resp.json()["rank"] == 1

        resp = await client.get("/artists/did:plc:r2/analytics")
        assert resp.json()["rank"] == 2

        resp = await client.get("/artists/did:plc:r3/analytics")
        assert resp.json()["rank"] == 3


async def test_rank_is_null_outside_top_10(test_app: FastAPI, db_session: AsyncSession):
    """artists outside the top 10 get rank=null."""
    artists = []
    for i in range(11):
        artist = Artist(
            did=f"did:plc:rank{i}",
            handle=f"rank{i}.bsky.social",
            display_name=f"Rank {i}",
            pds_url="https://test.pds",
        )
        db_session.add(artist)
        artists.append(artist)

    await db_session.flush()

    for i, artist in enumerate(artists):
        db_session.add(
            Track(
                title=f"Track {i}",
                artist_did=artist.did,
                file_id=f"rank_file_{i}",
                file_type="mp3",
                play_count=(11 - i) * 100,
            )
        )

    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        # artist 0 (highest plays) should be rank 1
        resp = await client.get(f"/artists/{artists[0].did}/analytics")
        assert resp.json()["rank"] == 1

        # artist 9 (10th highest) should be rank 10
        resp = await client.get(f"/artists/{artists[9].did}/analytics")
        assert resp.json()["rank"] == 10

        # artist 10 (11th) should be null
        resp = await client.get(f"/artists/{artists[10].did}/analytics")
        assert resp.json()["rank"] is None
