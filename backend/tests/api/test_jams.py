"""tests for jam api endpoints."""

from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session
from backend._internal.feature_flags import enable_flag
from backend._internal.jams import JamService, jam_service
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


async def test_next_after_add_tracks(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """next after add_tracks must advance — regression for shallow-copy bug."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]

        await client.post(
            f"/jams/{code}/command",
            json={"type": "add_tracks", "track_ids": ["t2", "t3"]},
        )

        next_response = await client.post(
            f"/jams/{code}/command",
            json={"type": "next"},
        )

    state = next_response.json()["state"]
    assert state["track_ids"] == ["t1", "t2", "t3"]
    assert state["current_index"] == 1
    assert state["current_track_id"] == "t2"


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


# ── output device tests ────────────────────────────────────────────


async def test_create_jam_has_null_output(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that newly created jams have output_client_id = null."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post("/jams/", json={"track_ids": ["t1"]})

    assert response.status_code == 200
    assert response.json()["state"]["output_client_id"] is None


async def test_auto_set_output_on_host_sync(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that output_client_id is auto-set to host on first sync with real DB state."""
    from starlette.websockets import WebSocket

    # create jam via API (writes to DB)
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]
        jam_id = create_response.json()["id"]
        assert create_response.json()["state"]["output_client_id"] is None

    # connect host WS and send sync with client_id
    ws = AsyncMock(spec=WebSocket)
    await jam_service.connect_ws(jam_id, ws, "did:test:host")
    await jam_service._handle_sync(
        jam_id, "did:test:host", {"client_id": "host-abc-123", "last_id": None}, ws
    )

    # verify DB state was updated
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        get_response = await client.get(f"/jams/{code}")
        state = get_response.json()["state"]
        assert state["output_client_id"] == "host-abc-123"
        assert state["output_did"] == "did:test:host"

    # cleanup
    await jam_service.disconnect_ws(jam_id, ws)


async def test_set_output_command(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test set_output command changes output_client_id in state."""
    from starlette.websockets import WebSocket

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]
        jam_id = create_response.json()["id"]

    # register a WS with a client_id so set_output can validate
    ws = AsyncMock(spec=WebSocket)
    await jam_service.connect_ws(jam_id, ws, "did:test:host")
    jam_service._ws_client_ids[ws] = "my-client-id"

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/jams/{code}/command",
            json={"type": "set_output", "client_id": "my-client-id"},
        )

    assert response.status_code == 200
    assert response.json()["state"]["output_client_id"] == "my-client-id"

    # cleanup
    await jam_service.disconnect_ws(jam_id, ws)


async def test_set_output_validates_client_id(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that set_output rejects client_id that doesn't match sender's WS."""
    from starlette.websockets import WebSocket

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]
        jam_id = create_response.json()["id"]

    # register WS with one client_id
    ws = AsyncMock(spec=WebSocket)
    await jam_service.connect_ws(jam_id, ws, "did:test:host")
    jam_service._ws_client_ids[ws] = "real-client-id"

    # try to set output with a different client_id
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"/jams/{code}/command",
            json={"type": "set_output", "client_id": "spoofed-client-id"},
        )

    # should fail — client_id mismatch
    assert response.status_code == 400

    # cleanup
    await jam_service.disconnect_ws(jam_id, ws)


async def test_output_clears_on_disconnect(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that output_client_id clears and playback pauses when output WS disconnects."""
    from starlette.websockets import WebSocket

    # create jam and set output via API
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/", json={"track_ids": ["t1"], "is_playing": True}
        )
        code = create_response.json()["code"]
        jam_id = create_response.json()["id"]

    # register host WS as output device
    ws = AsyncMock(spec=WebSocket)
    await jam_service.connect_ws(jam_id, ws, "did:test:host")
    jam_service._ws_client_ids[ws] = "host-output-client"

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        await client.post(
            f"/jams/{code}/command",
            json={"type": "set_output", "client_id": "host-output-client"},
        )

    # disconnect output device
    await jam_service.disconnect_ws(jam_id, ws)

    # verify DB state: output cleared, playback paused
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        get_response = await client.get(f"/jams/{code}")
        state = get_response.json()["state"]
        assert state["output_client_id"] is None
        assert state["output_did"] is None
        assert state["is_playing"] is False


async def test_output_clears_on_ws_replacement(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """regression: _close_ws_for_did must clear output before removing client_id mapping.

    when a user reconnects (new WS replaces old), _close_ws_for_did fires instead of
    disconnect_ws. if it pops the client_id first, the output stays pinned to a dead device.
    """
    from starlette.websockets import WebSocket

    # create jam and set host as output
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/", json={"track_ids": ["t1"], "is_playing": True}
        )
        code = create_response.json()["code"]
        jam_id = create_response.json()["id"]

    ws1 = AsyncMock(spec=WebSocket)
    await jam_service.connect_ws(jam_id, ws1, "did:test:host")
    jam_service._ws_client_ids[ws1] = "old-client-id"

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        await client.post(
            f"/jams/{code}/command",
            json={"type": "set_output", "client_id": "old-client-id"},
        )

    # reconnect — new WS replaces old (this calls _close_ws_for_did internally)
    ws2 = AsyncMock(spec=WebSocket)
    await jam_service.connect_ws(jam_id, ws2, "did:test:host")

    # output should have been cleared by _close_ws_for_did
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        get_response = await client.get(f"/jams/{code}")
        state = get_response.json()["state"]
        assert state["output_client_id"] is None, (
            "output_client_id should be cleared when output device's WS is replaced"
        )
        assert state["is_playing"] is False

    # cleanup
    await jam_service.disconnect_ws(jam_id, ws2)


async def test_non_output_disconnect_no_effect() -> None:
    """test that a non-output participant disconnecting doesn't affect output."""
    from starlette.websockets import WebSocket

    service = JamService()
    jam_id = "test-noeffect"

    ws_host = AsyncMock(spec=WebSocket)
    ws_joiner = AsyncMock(spec=WebSocket)

    await service.connect_ws(jam_id, ws_host, "did:test:host")
    service._ws_client_ids[ws_host] = "host-client"

    await service.connect_ws(jam_id, ws_joiner, "did:test:joiner")
    service._ws_client_ids[ws_joiner] = "joiner-client"

    # disconnect the non-output joiner
    await service.disconnect_ws(jam_id, ws_joiner)

    # host's client_id should still be tracked
    assert service._ws_client_ids[ws_host] == "host-client"
    assert ws_host in service._connections[jam_id]

    # cleanup
    await service.disconnect_ws(jam_id, ws_host)


# ── cross-client command tests ────────────────────────────────────


async def test_cross_client_next_command(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test that a non-host participant can send 'next' and it updates state for all."""
    from backend._internal import require_auth

    # create jam as host with 4 tracks
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/",
            json={
                "name": "cross client test",
                "track_ids": ["t1", "t2", "t3", "t4"],
                "is_playing": True,
            },
        )
        code = create_response.json()["code"]
        assert create_response.json()["state"]["current_index"] == 0
        assert create_response.json()["state"]["current_track_id"] == "t1"

    # second user joins
    async def mock_joiner_auth() -> Session:
        return MockSession(did=second_user)

    app.dependency_overrides[require_auth] = mock_joiner_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        join_response = await client.post(f"/jams/{code}/join")
        assert join_response.status_code == 200

        # joiner sends "next" command
        next_response = await client.post(
            f"/jams/{code}/command", json={"type": "next"}
        )
        assert next_response.status_code == 200
        state = next_response.json()["state"]
        assert state["current_index"] == 1
        assert state["current_track_id"] == "t2"
        assert state["progress_ms"] == 0
        # is_playing should be preserved (not changed by "next")
        assert state["is_playing"] is True

        # joiner sends "next" again
        next2_response = await client.post(
            f"/jams/{code}/command", json={"type": "next"}
        )
        assert next2_response.status_code == 200
        state2 = next2_response.json()["state"]
        assert state2["current_index"] == 2
        assert state2["current_track_id"] == "t3"

    # verify state from host's perspective
    async def mock_host_auth() -> Session:
        return MockSession(did="did:test:host")

    app.dependency_overrides[require_auth] = mock_host_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        get_response = await client.get(f"/jams/{code}")
        assert get_response.status_code == 200
        host_view = get_response.json()
        assert host_view["state"]["current_index"] == 2
        assert host_view["state"]["current_track_id"] == "t3"


async def test_cross_client_play_pause(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test that a non-host participant can play/pause."""
    from backend._internal import require_auth

    # create jam as host (starts paused)
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/",
            json={"track_ids": ["t1", "t2"]},
        )
        code = create_response.json()["code"]
        assert create_response.json()["state"]["is_playing"] is False

    # joiner joins and sends play
    async def mock_joiner_auth() -> Session:
        return MockSession(did=second_user)

    app.dependency_overrides[require_auth] = mock_joiner_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        await client.post(f"/jams/{code}/join")

        play_response = await client.post(
            f"/jams/{code}/command", json={"type": "play"}
        )
        assert play_response.status_code == 200
        assert play_response.json()["state"]["is_playing"] is True

        pause_response = await client.post(
            f"/jams/{code}/command", json={"type": "pause"}
        )
        assert pause_response.status_code == 200
        assert pause_response.json()["state"]["is_playing"] is False


async def test_cross_client_seek(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test that a non-host participant can seek."""
    from backend._internal import require_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]

    async def mock_joiner_auth() -> Session:
        return MockSession(did=second_user)

    app.dependency_overrides[require_auth] = mock_joiner_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        await client.post(f"/jams/{code}/join")

        seek_response = await client.post(
            f"/jams/{code}/command",
            json={"type": "seek", "position_ms": 45000},
        )
        assert seek_response.status_code == 200
        assert seek_response.json()["state"]["progress_ms"] == 45000


async def test_cross_client_add_tracks(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test that a non-host participant can add tracks."""
    from backend._internal import require_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]

    async def mock_joiner_auth() -> Session:
        return MockSession(did=second_user)

    app.dependency_overrides[require_auth] = mock_joiner_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        await client.post(f"/jams/{code}/join")

        add_response = await client.post(
            f"/jams/{code}/command",
            json={"type": "add_tracks", "track_ids": ["t2", "t3"]},
        )
        assert add_response.status_code == 200
        assert add_response.json()["state"]["track_ids"] == ["t1", "t2", "t3"]
        assert add_response.json()["tracks_changed"] is True


async def test_output_preserved_across_cross_client_commands(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test that output_client_id is preserved when non-output sends commands."""
    from starlette.websockets import WebSocket

    from backend._internal import require_auth

    # create jam as host
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/",
            json={"track_ids": ["t1", "t2", "t3"], "is_playing": True},
        )
        code = create_response.json()["code"]
        jam_id = create_response.json()["id"]

    # set up host as output device
    ws_host = AsyncMock(spec=WebSocket)
    await jam_service.connect_ws(jam_id, ws_host, "did:test:host")
    jam_service._ws_client_ids[ws_host] = "host-client-id"

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        set_output_response = await client.post(
            f"/jams/{code}/command",
            json={"type": "set_output", "client_id": "host-client-id"},
        )
        assert set_output_response.status_code == 200
        assert (
            set_output_response.json()["state"]["output_client_id"] == "host-client-id"
        )

    # joiner joins and sends next — output_client_id should be preserved
    async def mock_joiner_auth() -> Session:
        return MockSession(did=second_user)

    app.dependency_overrides[require_auth] = mock_joiner_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        await client.post(f"/jams/{code}/join")

        next_response = await client.post(
            f"/jams/{code}/command", json={"type": "next"}
        )
        assert next_response.status_code == 200
        state = next_response.json()["state"]
        assert state["current_index"] == 1
        assert state["output_client_id"] == "host-client-id"
        assert state["output_did"] == "did:test:host"
        assert state["is_playing"] is True

    # cleanup
    await jam_service.disconnect_ws(jam_id, ws_host)
