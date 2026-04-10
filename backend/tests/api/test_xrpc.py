"""tests for XRPC mention search endpoint."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend.main import app
from backend.models import Artist, Track


@pytest.fixture
async def search_fixtures(db_session: AsyncSession) -> dict[str, int]:
    """create test data for mention search."""
    artist = Artist(
        did="did:plc:xrpc_test",
        handle="stellz.test",
        display_name="Stellz",
    )
    db_session.add(artist)
    await db_session.flush()

    track = Track(
        title="banana mix",
        artist_did=artist.did,
        file_id="xrpc_test_123",
        file_type="mp3",
        r2_url="https://cdn.example.com/audio/banana.mp3",
        image_url="https://cdn.example.com/images/banana.png",
    )
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)

    return {"track_id": track.id}


@pytest.fixture
def test_app(db_session: AsyncSession) -> FastAPI:
    """get test app with db session dependency."""
    _ = db_session
    return app


async def test_mention_search_returns_results(
    test_app: FastAPI, search_fixtures: dict[str, int]
) -> None:
    """test that mention search returns formatted results."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/xrpc/parts.page.mention.search",
            params={
                "service": "at://did:plc:test/parts.page.mention.service/plyr",
                "search": "banana",
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert len(data["results"]) > 0

    track_result = next(
        (r for r in data["results"] if r["labels"][0]["text"] == "track"), None
    )
    assert track_result is not None
    assert track_result["name"] == "banana mix"
    assert "embed" in track_result
    assert "/embed/track/" in track_result["embed"]["src"]
    assert track_result["embed"]["aspectRatio"] == {"width": 16, "height": 9}
    assert track_result["href"].endswith(f"/track/{search_fixtures['track_id']}")


async def test_mention_search_scoped_to_tracks(
    test_app: FastAPI, search_fixtures: dict[str, int]
) -> None:
    """test that scope=tracks only returns track results."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/xrpc/parts.page.mention.search",
            params={
                "service": "at://did:plc:test/parts.page.mention.service/plyr",
                "search": "banana",
                "scope": "tracks",
            },
        )

    assert response.status_code == 200
    data = response.json()
    for result in data["results"]:
        assert result["labels"][0]["text"] == "track"


async def test_mention_search_artist_results(
    test_app: FastAPI, search_fixtures: dict[str, int]
) -> None:
    """test that artist results have correct format (no embed)."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/xrpc/parts.page.mention.search",
            params={
                "service": "at://did:plc:test/parts.page.mention.service/plyr",
                "search": "stellz",
                "scope": "artists",
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert len(data["results"]) > 0

    artist_result = data["results"][0]
    assert artist_result["name"] == "Stellz"
    assert "@stellz.test" in artist_result["description"]
    assert "embed" not in artist_result


async def test_mention_search_short_query(test_app: FastAPI) -> None:
    """test that very short queries return empty results."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/xrpc/parts.page.mention.search",
            params={
                "service": "at://did:plc:test/parts.page.mention.service/plyr",
                "search": "a",
            },
        )

    assert response.status_code == 200
    assert response.json() == {"results": []}


async def test_mention_search_no_results(test_app: FastAPI) -> None:
    """test that unmatched queries return empty results."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/xrpc/parts.page.mention.search",
            params={
                "service": "at://did:plc:test/parts.page.mention.service/plyr",
                "search": "xyznonexistent",
            },
        )

    assert response.status_code == 200
    assert response.json() == {"results": []}
