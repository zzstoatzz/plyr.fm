"""tests for queue api endpoints."""

from collections.abc import Generator

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, queue_service
from backend.main import app


# create a mock session object
class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:user123"):
        self.did = did
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"


@pytest.fixture
def test_app(db_session: AsyncSession) -> Generator[FastAPI, None, None]:
    """create test app with mocked auth."""
    from backend._internal import require_auth

    # mock the auth dependency to return a mock session
    async def mock_require_auth() -> Session:
        return MockSession()

    # override the auth dependency
    app.dependency_overrides[require_auth] = mock_require_auth

    # clear the queue service cache before each test
    # the queue_service is a singleton that persists state across tests
    queue_service.cache.clear()

    yield app

    # cleanup
    app.dependency_overrides.clear()
    # clear cache after test too
    queue_service.cache.clear()


async def test_get_queue_empty_state(test_app: FastAPI, db_session: AsyncSession):
    """test GET /queue returns empty state for new user."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/queue/")

    assert response.status_code == 200
    data = response.json()

    # verify empty queue structure
    assert data["state"]["track_ids"] == []
    assert data["state"]["current_index"] == 0
    assert data["state"]["current_track_id"] is None
    assert data["state"]["shuffle"] is False
    assert data["state"]["auto_advance"] is True
    assert data["state"]["original_order_ids"] == []
    assert data["state"]["playback_position"] == 0
    assert data["state"]["is_paused"] is True
    assert data["revision"] == 0
    assert data["tracks"] == []

    # verify ETag header
    assert response.headers["etag"] == '"0"'


async def test_put_queue_creates_new_state(test_app: FastAPI, db_session: AsyncSession):
    """test PUT /queue creates new queue state."""
    new_state = {
        "track_ids": ["track1", "track2", "track3"],
        "current_index": 1,
        "current_track_id": "track2",
        "shuffle": True,
        "original_order_ids": ["track1", "track2", "track3"],
    }

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.put("/queue/", json={"state": new_state})

    assert response.status_code == 200
    data = response.json()

    # auto_advance comes from user preferences, not queue state
    assert data["state"]["track_ids"] == new_state["track_ids"]
    assert data["state"]["current_index"] == new_state["current_index"]
    assert data["state"]["current_track_id"] == new_state["current_track_id"]
    assert data["state"]["shuffle"] == new_state["shuffle"]
    assert data["state"]["original_order_ids"] == new_state["original_order_ids"]
    assert "auto_advance" in data["state"]  # present but from preferences
    assert data["state"].get("playback_position", 0) == 0
    assert data["state"].get("is_paused", True) is True
    assert data["revision"] == 1  # first update should be revision 1
    assert data["tracks"] == []


async def test_get_queue_returns_updated_state(
    test_app: FastAPI, db_session: AsyncSession
):
    """test GET /queue returns previously saved state."""
    # first, create a queue
    new_state = {
        "track_ids": ["track1", "track2"],
        "current_index": 0,
        "current_track_id": "track1",
        "shuffle": False,
        "original_order_ids": ["track1", "track2"],
    }

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        put_response = await client.put("/queue/", json={"state": new_state})
        assert put_response.status_code == 200
        put_revision = put_response.json()["revision"]

        # now get it back
        get_response = await client.get("/queue/")

    assert get_response.status_code == 200
    data = get_response.json()

    # verify queue state fields (auto_advance comes from preferences)
    assert data["state"]["track_ids"] == new_state["track_ids"]
    assert data["state"]["current_index"] == new_state["current_index"]
    assert data["state"]["current_track_id"] == new_state["current_track_id"]
    assert data["state"]["shuffle"] == new_state["shuffle"]
    assert data["state"]["original_order_ids"] == new_state["original_order_ids"]
    assert "auto_advance" in data["state"]
    assert data["state"].get("playback_position", 0) == 0
    assert data["state"].get("is_paused", True) is True
    assert data["revision"] == put_revision
    assert data["tracks"] == []

    # verify ETag matches revision
    assert get_response.headers["etag"] == f'"{put_revision}"'


async def test_put_queue_with_matching_revision_succeeds(
    test_app: FastAPI, db_session: AsyncSession
):
    """test PUT /queue with correct If-Match header succeeds."""
    # create initial state
    initial_state = {
        "track_ids": ["track1"],
        "current_index": 0,
        "current_track_id": "track1",
        "shuffle": False,
        "original_order_ids": ["track1"],
    }

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        # create initial state
        response1 = await client.put("/queue/", json={"state": initial_state})
        assert response1.status_code == 200
        revision1 = response1.json()["revision"]

        # update with matching revision
        updated_state = {
            **initial_state,
            "track_ids": ["track1", "track2"],
        }
        response2 = await client.put(
            "/queue/",
            json={"state": updated_state},
            headers={"If-Match": f'"{revision1}"'},
        )

    assert response2.status_code == 200
    data = response2.json()
    assert data["state"]["track_ids"] == ["track1", "track2"]
    assert data["revision"] == revision1 + 1
    assert data["tracks"] == []


async def test_put_queue_with_mismatched_revision_fails(
    test_app: FastAPI, db_session: AsyncSession
):
    """test PUT /queue with wrong If-Match header returns 409 conflict."""
    # create initial state
    initial_state = {
        "track_ids": ["track1"],
        "current_index": 0,
        "current_track_id": "track1",
        "shuffle": False,
        "original_order_ids": ["track1"],
    }

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        # create initial state
        response1 = await client.put("/queue/", json={"state": initial_state})
        assert response1.status_code == 200

        # try to update with wrong revision
        updated_state = {
            **initial_state,
            "track_ids": ["track1", "track2"],
        }
        response2 = await client.put(
            "/queue/",
            json={"state": updated_state},
            headers={"If-Match": '"999"'},  # wrong revision
        )

    assert response2.status_code == 409
    assert "conflict" in response2.json()["detail"].lower()


async def test_put_queue_without_if_match_always_succeeds(
    test_app: FastAPI, db_session: AsyncSession
):
    """test PUT /queue without If-Match header always updates (no conflict check)."""
    initial_state = {
        "track_ids": ["track1"],
        "current_index": 0,
        "current_track_id": "track1",
        "shuffle": False,
        "original_order_ids": ["track1"],
    }

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        # create initial state
        response1 = await client.put("/queue/", json={"state": initial_state})
        assert response1.status_code == 200

        # update without If-Match (should always succeed)
        updated_state = {
            **initial_state,
            "track_ids": ["track1", "track2", "track3"],
        }
        response2 = await client.put("/queue/", json={"state": updated_state})

    assert response2.status_code == 200
    data = response2.json()
    assert data["state"]["track_ids"] == ["track1", "track2", "track3"]


async def test_queue_persists_playback_metadata(
    test_app: FastAPI, db_session: AsyncSession
):
    """queue state should round-trip playback position and paused flag."""
    new_state = {
        "track_ids": ["track1"],
        "current_index": 0,
        "current_track_id": "track1",
        "shuffle": False,
        "original_order_ids": ["track1"],
        "playback_position": 42.5,
        "is_paused": False,
    }

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        put_response = await client.put("/queue/", json={"state": new_state})
        assert put_response.status_code == 200

        get_response = await client.get("/queue/")

    assert get_response.status_code == 200
    data = get_response.json()
    assert data["state"]["playback_position"] == pytest.approx(42.5)
    assert data["state"]["is_paused"] is False


async def test_queue_state_isolated_by_did(test_app: FastAPI, db_session: AsyncSession):
    """test that different users have isolated queue states."""
    from backend._internal import require_auth

    # user 1
    async def mock_user1_auth() -> Session:
        return MockSession(did="did:test:user1")

    app.dependency_overrides[require_auth] = mock_user1_auth

    user1_state = {
        "track_ids": ["user1_track1"],
        "current_index": 0,
        "current_track_id": "user1_track1",
        "shuffle": False,
        "original_order_ids": ["user1_track1"],
    }

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response1 = await client.put("/queue/", json={"state": user1_state})
        assert response1.status_code == 200

    # user 2
    async def mock_user2_auth() -> Session:
        return MockSession(did="did:test:user2")

    app.dependency_overrides[require_auth] = mock_user2_auth

    user2_state = {
        "track_ids": ["user2_track1"],
        "current_index": 0,
        "current_track_id": "user2_track1",
        "shuffle": False,
        "original_order_ids": ["user2_track1"],
    }

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response2 = await client.put("/queue/", json={"state": user2_state})
        assert response2.status_code == 200

        # verify user2 sees only their state
        get_response = await client.get("/queue/")
        assert get_response.json()["state"]["track_ids"] == ["user2_track1"]

    # switch back to user 1 and verify their state persisted
    app.dependency_overrides[require_auth] = mock_user1_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        get_response = await client.get("/queue/")
        assert get_response.json()["state"]["track_ids"] == ["user1_track1"]
