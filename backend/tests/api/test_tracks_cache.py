"""tests for anonymous discovery feed caching."""

from collections.abc import Generator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.tasks.hooks import invalidate_tracks_discovery_cache
from backend.api.tracks.constants import DISCOVERY_CACHE_KEY
from backend.api.tracks.listing import TracksListResponse
from backend.main import app
from backend.models import Artist, Track, get_db

SAMPLE_RESPONSE = TracksListResponse(tracks=[], next_cursor=None, has_more=False)


async def test_anonymous_discovery_cache_hit() -> None:
    """cached response deserializes correctly from Redis."""
    cached_json = SAMPLE_RESPONSE.model_dump_json()
    result = TracksListResponse.model_validate_json(cached_json)
    assert result == SAMPLE_RESPONSE


async def test_invalidate_clears_cache() -> None:
    """invalidate_tracks_discovery_cache deletes the cache key."""
    mock_redis = AsyncMock()
    mock_redis.delete = AsyncMock()

    with patch(
        "backend._internal.tasks.hooks.get_async_redis_client",
        return_value=mock_redis,
    ):
        await invalidate_tracks_discovery_cache()

    mock_redis.delete.assert_awaited_once_with(DISCOVERY_CACHE_KEY)


async def test_invalidate_handles_redis_error() -> None:
    """invalidation silently handles Redis errors."""
    mock_redis = AsyncMock()
    mock_redis.delete.side_effect = RedisConnectionError("redis down")

    with patch(
        "backend._internal.tasks.hooks.get_async_redis_client",
        return_value=mock_redis,
    ):
        # should not raise
        await invalidate_tracks_discovery_cache()


@pytest.fixture
def anon_test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """test app with no auth (anonymous user), using test db session."""

    async def mock_get_db() -> AsyncSession:  # type: ignore[misc]
        yield db_session

    app.dependency_overrides[get_db] = mock_get_db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def ten_tracks(db_session: AsyncSession) -> list[Track]:
    """create an artist with 10 tracks."""
    artist = Artist(
        did="did:plc:cachetest",
        handle="cachetest.bsky.social",
        display_name="Cache Test Artist",
    )
    db_session.add(artist)
    await db_session.flush()

    tracks = []
    for i in range(10):
        track = Track(
            title=f"Track {i}",
            artist_did=artist.did,
            file_id=f"cache_test_{i}",
            file_type="mp3",
        )
        db_session.add(track)
        tracks.append(track)
    await db_session.commit()
    return tracks


async def test_limit_bypasses_cache(
    anon_test_app: FastAPI,
    ten_tracks: list[Track],
) -> None:
    """regression: ?limit=N must not return a cached response with more tracks.

    previously, anonymous requests with an explicit limit hit the Redis cache
    populated by a default (50-track) request, ignoring the limit entirely.
    """
    mock_redis = AsyncMock()
    # simulate a cached response with all 10 tracks
    cached = TracksListResponse(tracks=[], next_cursor=None, has_more=False)
    mock_redis.get = AsyncMock(return_value=cached.model_dump_json())
    mock_redis.set = AsyncMock()

    with patch(
        "backend.api.tracks.listing.get_async_redis_client",
        return_value=mock_redis,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=anon_test_app), base_url="http://test"
        ) as client:
            # request with explicit limit — should NOT use cache
            response = await client.get("/tracks/?limit=3")

    assert response.status_code == 200
    data = response.json()
    # cache was not read (limit makes request non-cacheable)
    assert len(data["tracks"]) == 3
