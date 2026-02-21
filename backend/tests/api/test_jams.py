"""tests for jam api endpoints."""

from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend._internal.feature_flags import enable_flag
from backend._internal.jams import JamService
from backend.main import app
from backend.models import Artist


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:host"):
        self.did = did
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.session_id = "test_session"
        self.handle = "test.host"
        self.oauth_session = {}


@pytest.fixture
async def test_app(db_session: AsyncSession) -> AsyncGenerator[FastAPI, None]:
    """create test app with mocked auth and jams flag."""
    from backend._internal import require_auth

    mock_session = MockSession()

    async def mock_require_auth() -> Session:
        return mock_session

    app.dependency_overrides[require_auth] = mock_require_auth

    # create the test artist
    artist = Artist(
        did="did:test:host",
        handle="test.host",
        display_name="Test Host",
    )
    db_session.add(artist)
    await db_session.flush()

    # enable jams flag for the test user
    await enable_flag(db_session, "did:test:host", "jams")
    await db_session.commit()

    yield app

    app.dependency_overrides.clear()


@pytest.fixture
async def second_user(db_session: AsyncSession) -> str:
    """create a second test artist with jams flag."""
    artist = Artist(
        did="did:test:joiner",
        handle="test.joiner",
        display_name="Test Joiner",
    )
    db_session.add(artist)
    await enable_flag(db_session, "did:test:joiner", "jams")
    await db_session.commit()
    return "did:test:joiner"


async def test_create_jam(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test POST /jams/ creates a jam."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/jams/",
            json={"name": "test jam", "track_ids": ["track1", "track2"]},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "test jam"
    assert data["host_did"] == "did:test:host"
    assert data["is_active"] is True
    assert len(data["code"]) == 8
    assert data["state"]["track_ids"] == ["track1", "track2"]
    assert data["state"]["current_index"] == 0
    assert data["state"]["current_track_id"] == "track1"
    assert data["revision"] == 1


async def test_create_jam_empty(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test creating a jam with no tracks."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post("/jams/", json={})

    assert response.status_code == 200
    data = response.json()
    assert data["state"]["track_ids"] == []
    assert data["state"]["is_playing"] is False


async def test_get_jam_by_code(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test GET /jams/{code} returns jam details."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "get test"})
        code = create_response.json()["code"]

        response = await client.get(f"/jams/{code}")

    assert response.status_code == 200
    data = response.json()
    assert data["code"] == code
    assert data["name"] == "get test"


async def test_get_jam_not_found(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test GET /jams/{code} returns 404 for unknown code."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/jams/nonexist")

    assert response.status_code == 404


async def test_join_jam(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test POST /jams/{code}/join adds a participant."""
    from backend._internal import require_auth

    # create jam as host
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "join test"})
        code = create_response.json()["code"]

    # switch to second user
    async def mock_joiner_auth() -> Session:
        return MockSession(did=second_user)

    app.dependency_overrides[require_auth] = mock_joiner_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(f"/jams/{code}/join")

    assert response.status_code == 200
    data = response.json()
    assert len(data["participants"]) == 2
    participant_dids = {p["did"] for p in data["participants"]}
    assert "did:test:host" in participant_dids
    assert second_user in participant_dids


async def test_leave_jam(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test POST /jams/{code}/leave removes participant."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "leave test"})
        code = create_response.json()["code"]

        response = await client.post(f"/jams/{code}/leave")

    assert response.status_code == 200
    assert response.json()["ok"] is True


async def test_leave_ends_jam_when_last(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that leaving as last participant ends the jam."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "last leave test"})
        code = create_response.json()["code"]

        # leave (only participant)
        await client.post(f"/jams/{code}/leave")

        # jam should no longer be active
        get_response = await client.get(f"/jams/{code}")

    assert get_response.status_code == 200
    assert get_response.json()["is_active"] is False


async def test_end_jam_host_only(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test that only the host can end a jam."""
    from backend._internal import require_auth

    # create jam as host
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "end test"})
        code = create_response.json()["code"]

    # switch to second user and try to end
    async def mock_joiner_auth() -> Session:
        return MockSession(did=second_user)

    app.dependency_overrides[require_auth] = mock_joiner_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        # join first
        await client.post(f"/jams/{code}/join")
        # try to end
        response = await client.post(f"/jams/{code}/end")

    assert response.status_code == 403


async def test_end_jam_by_host(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test host can end their jam."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "host end test"})
        code = create_response.json()["code"]

        response = await client.post(f"/jams/{code}/end")

    assert response.status_code == 200
    assert response.json()["ok"] is True


async def test_command_play_pause(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test play and pause commands."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/",
            json={"track_ids": ["t1"]},
        )
        code = create_response.json()["code"]

        # play
        play_response = await client.post(
            f"/jams/{code}/command", json={"type": "play"}
        )
        assert play_response.status_code == 200
        assert play_response.json()["state"]["is_playing"] is True

        # pause
        pause_response = await client.post(
            f"/jams/{code}/command", json={"type": "pause"}
        )
        assert pause_response.status_code == 200
        assert pause_response.json()["state"]["is_playing"] is False


async def test_command_seek(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test seek command."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/",
            json={"track_ids": ["t1"]},
        )
        code = create_response.json()["code"]

        response = await client.post(
            f"/jams/{code}/command",
            json={"type": "seek", "position_ms": 30000},
        )

    assert response.status_code == 200
    assert response.json()["state"]["progress_ms"] == 30000


async def test_command_next_previous(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test next and previous commands."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/",
            json={"track_ids": ["t1", "t2", "t3"]},
        )
        code = create_response.json()["code"]

        # next
        next_response = await client.post(
            f"/jams/{code}/command", json={"type": "next"}
        )
        assert next_response.json()["state"]["current_index"] == 1
        assert next_response.json()["state"]["current_track_id"] == "t2"

        # next again
        next2_response = await client.post(
            f"/jams/{code}/command", json={"type": "next"}
        )
        assert next2_response.json()["state"]["current_index"] == 2

        # previous
        prev_response = await client.post(
            f"/jams/{code}/command", json={"type": "previous"}
        )
        assert prev_response.json()["state"]["current_index"] == 1
        assert prev_response.json()["state"]["current_track_id"] == "t2"


async def test_command_add_tracks(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test add_tracks command."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]

        response = await client.post(
            f"/jams/{code}/command",
            json={"type": "add_tracks", "track_ids": ["t2", "t3"]},
        )

    assert response.status_code == 200
    assert response.json()["state"]["track_ids"] == ["t1", "t2", "t3"]
    assert response.json()["tracks_changed"] is True


async def test_command_remove_track(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test remove_track command."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/",
            json={"track_ids": ["t1", "t2", "t3"]},
        )
        code = create_response.json()["code"]

        response = await client.post(
            f"/jams/{code}/command",
            json={"type": "remove_track", "index": 1},
        )

    assert response.status_code == 200
    assert response.json()["state"]["track_ids"] == ["t1", "t3"]
    assert response.json()["tracks_changed"] is True


async def test_revision_monotonicity(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that revision increases monotonically."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/",
            json={"track_ids": ["t1"]},
        )
        code = create_response.json()["code"]
        rev = create_response.json()["revision"]
        assert rev == 1

        for _ in range(5):
            cmd_response = await client.post(
                f"/jams/{code}/command", json={"type": "play"}
            )
            new_rev = cmd_response.json()["revision"]
            assert new_rev > rev
            rev = new_rev


async def test_auto_leave_previous_jam(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that creating a new jam auto-leaves the previous one."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        # create first jam
        first_response = await client.post("/jams/", json={"name": "first jam"})
        first_code = first_response.json()["code"]

        # create second jam (should auto-leave first)
        second_response = await client.post("/jams/", json={"name": "second jam"})
        second_code = second_response.json()["code"]

        assert first_code != second_code

        # check active jam is the second one
        active_response = await client.get("/jams/active")

    assert active_response.status_code == 200
    assert active_response.json()["code"] == second_code


async def test_flag_gating(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test that users without the jams flag get 403."""
    from backend._internal import require_auth

    # create a user without the flag
    no_flag_artist = Artist(
        did="did:test:noflag",
        handle="test.noflag",
        display_name="No Flag",
    )
    db_session.add(no_flag_artist)
    await db_session.commit()

    async def mock_noflag_auth() -> Session:
        return MockSession(did="did:test:noflag")

    app.dependency_overrides[require_auth] = mock_noflag_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post("/jams/", json={})

    assert response.status_code == 403
    assert "not enabled" in response.json()["detail"]


async def test_get_active_jam_none(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test GET /jams/active returns null when not in a jam."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/jams/active")

    assert response.status_code == 200
    assert response.json() is None


async def test_code_uniqueness(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test that each jam gets a unique code."""
    codes = set()
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        for i in range(5):
            response = await client.post("/jams/", json={"name": f"jam {i}"})
            assert response.status_code == 200
            codes.add(response.json()["code"])

    assert len(codes) == 5


async def test_command_set_index(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test set_index command jumps to a specific track."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/",
            json={"track_ids": ["t1", "t2", "t3", "t4"]},
        )
        code = create_response.json()["code"]

        # jump to index 2
        response = await client.post(
            f"/jams/{code}/command", json={"type": "set_index", "index": 2}
        )
        assert response.status_code == 200
        state = response.json()["state"]
        assert state["current_index"] == 2
        assert state["current_track_id"] == "t3"
        assert state["progress_ms"] == 0

        # jump to index 0
        response = await client.post(
            f"/jams/{code}/command", json={"type": "set_index", "index": 0}
        )
        assert response.status_code == 200
        state = response.json()["state"]
        assert state["current_index"] == 0
        assert state["current_track_id"] == "t1"

        # out-of-bounds index is a no-op (state unchanged, but command succeeds)
        response = await client.post(
            f"/jams/{code}/command", json={"type": "set_index", "index": 10}
        )
        assert response.status_code == 200
        assert response.json()["state"]["current_index"] == 0
        assert response.json()["state"]["current_track_id"] == "t1"


async def test_command_non_participant_rejected(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test that non-participants cannot send commands."""
    from backend._internal import require_auth

    # create jam as host
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1", "t2"]})
        code = create_response.json()["code"]

    # switch to second user (NOT joined)
    async def mock_joiner_auth() -> Session:
        return MockSession(did=second_user)

    app.dependency_overrides[require_auth] = mock_joiner_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(f"/jams/{code}/command", json={"type": "next"})

    # command should fail — not a participant
    assert response.status_code == 400


async def test_sequential_commands_get_distinct_revisions(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that each command gets a distinct revision (verifies no clobbering)."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/", json={"track_ids": ["t1", "t2", "t3"]}
        )
        code = create_response.json()["code"]
        assert create_response.json()["revision"] == 1

        # send two next commands back-to-back
        r1 = await client.post(f"/jams/{code}/command", json={"type": "next"})
        r2 = await client.post(f"/jams/{code}/command", json={"type": "next"})

    assert r1.json()["revision"] == 2
    assert r2.json()["revision"] == 3
    # both advanced the index correctly
    assert r1.json()["state"]["current_index"] == 1
    assert r2.json()["state"]["current_index"] == 2


async def test_did_socket_replacement() -> None:
    """test that connecting a second WS for the same DID closes the first."""
    from starlette.websockets import WebSocket

    service = JamService()
    jam_id = "test-jam-123"

    ws1 = AsyncMock(spec=WebSocket)
    ws2 = AsyncMock(spec=WebSocket)

    # connect first socket
    await service.connect_ws(jam_id, ws1, "did:test:user")
    assert jam_id in service._connections
    assert ws1 in service._connections[jam_id]

    # connect second socket for same DID — should close first
    await service.connect_ws(jam_id, ws2, "did:test:user")

    # first socket should have been closed with code 4010
    ws1.close.assert_awaited_once_with(code=4010, reason="replaced by new connection")

    # only second socket should be in connections
    assert ws2 in service._connections[jam_id]
    assert ws1 not in service._connections[jam_id]

    # DID mapping should point to second socket
    assert service._ws_by_did["did:test:user"] == (jam_id, ws2)
