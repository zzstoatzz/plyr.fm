"""tests for jam api endpoints."""

from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketDisconnect

from backend._internal import Session
from backend._internal.jams import JamService, jam_service
from backend.main import app
from backend.models import Artist


async def _update_queue(
    client: AsyncClient, code: str, track_ids: list[str], current_index: int
) -> dict[str, Any]:
    """send an update_queue command and return the response json."""
    r = await client.post(
        f"/jams/{code}/command",
        json={
            "type": "update_queue",
            "track_ids": track_ids,
            "current_index": current_index,
        },
    )
    assert r.status_code == 200
    return r.json()


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


async def test_update_queue_change_index(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test update_queue to advance and go back (replaces next/previous)."""
    tracks = ["t1", "t2", "t3"]
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": tracks})
        code = create_response.json()["code"]

        r1 = await _update_queue(client, code, tracks, 1)
        assert r1["state"]["current_index"] == 1
        assert r1["state"]["current_track_id"] == "t2"

        r2 = await _update_queue(client, code, tracks, 2)
        assert r2["state"]["current_index"] == 2

        r3 = await _update_queue(client, code, tracks, 1)
        assert r3["state"]["current_index"] == 1
        assert r3["state"]["current_track_id"] == "t2"


async def test_update_queue_add_tracks(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test update_queue with extended track list (replaces add_tracks)."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]
        r = await _update_queue(client, code, ["t1", "t2", "t3"], 0)

    assert r["state"]["track_ids"] == ["t1", "t2", "t3"]
    assert r["tracks_changed"] is True


async def test_sequential_update_queue(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """two update_queue calls: extend tracks, then advance — regression for shallow-copy bug."""
    tracks = ["t1", "t2", "t3"]
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]
        await _update_queue(client, code, tracks, 0)
        r = await _update_queue(client, code, tracks, 1)

    assert r["state"]["track_ids"] == tracks
    assert r["state"]["current_index"] == 1
    assert r["state"]["current_track_id"] == "t2"


async def test_update_queue_remove_track(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test update_queue with a track removed."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/", json={"track_ids": ["t1", "t2", "t3"]}
        )
        code = create_response.json()["code"]
        r = await _update_queue(client, code, ["t1", "t3"], 0)

    assert r["state"]["track_ids"] == ["t1", "t3"]
    assert r["tracks_changed"] is True


async def test_update_queue_reorder(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test update_queue with reordered track list (replaces move_track)."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/", json={"track_ids": ["t1", "t2", "t3", "t4"]}
        )
        code = create_response.json()["code"]

        r1 = await _update_queue(client, code, ["t3", "t1", "t2", "t4"], 1)
        assert r1["state"]["track_ids"] == ["t3", "t1", "t2", "t4"]
        assert r1["state"]["current_index"] == 1
        assert r1["state"]["current_track_id"] == "t1"

        r2 = await _update_queue(client, code, ["t3", "t2", "t4", "t1"], 3)
        assert r2["state"]["track_ids"] == ["t3", "t2", "t4", "t1"]
        assert r2["state"]["current_index"] == 3
        assert r2["state"]["current_track_id"] == "t1"
        assert r2["tracks_changed"] is True


async def test_update_queue_same_tracks_no_change(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test update_queue with same tracks reports tracks_changed=False."""
    tracks = ["t1", "t2"]
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": tracks})
        code = create_response.json()["code"]
        r = await _update_queue(client, code, tracks, 0)

    assert r["state"]["track_ids"] == tracks
    assert r["tracks_changed"] is False


async def test_update_queue_clear_upcoming(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test update_queue with truncated list (replaces clear_upcoming)."""
    full = ["t1", "t2", "t3", "t4"]
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": full})
        code = create_response.json()["code"]
        await _update_queue(client, code, full, 1)
        r = await _update_queue(client, code, ["t1", "t2"], 1)

    assert r["state"]["track_ids"] == ["t1", "t2"]
    assert r["state"]["current_index"] == 1
    assert r["state"]["current_track_id"] == "t2"
    assert r["tracks_changed"] is True


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


async def test_update_queue_set_index(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test update_queue to jump to a specific track (replaces set_index)."""
    tracks = ["t1", "t2", "t3", "t4"]
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": tracks})
        code = create_response.json()["code"]

        r1 = await _update_queue(client, code, tracks, 2)
        assert r1["state"]["current_index"] == 2
        assert r1["state"]["current_track_id"] == "t3"
        assert r1["state"]["progress_ms"] == 0

        r2 = await _update_queue(client, code, tracks, 0)
        assert r2["state"]["current_index"] == 0
        assert r2["state"]["current_track_id"] == "t1"


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
        response = await client.post(
            f"/jams/{code}/command",
            json={
                "type": "update_queue",
                "track_ids": ["t1", "t2"],
                "current_index": 1,
            },
        )

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

        tracks = ["t1", "t2", "t3"]
        r1 = await _update_queue(client, code, tracks, 1)
        r2 = await _update_queue(client, code, tracks, 2)

    assert r1["revision"] == 2
    assert r2["revision"] == 3
    assert r1["state"]["current_index"] == 1
    assert r2["state"]["current_index"] == 2


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


async def test_output_disconnect_no_remaining_pauses(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that output clears and playback pauses when the only client disconnects (no fallback)."""
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

    # disconnect output device (no other clients connected)
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

    # mock _clear_output_if_matches to avoid DB access (standalone JamService has no DB)
    with patch.object(service, "_clear_output_if_matches", new_callable=AsyncMock):
        # disconnect the non-output joiner
        await service.disconnect_ws(jam_id, ws_joiner)

        # host's client_id should still be tracked
        assert service._ws_client_ids[ws_host] == "host-client"
        assert ws_host in service._connections[jam_id]

        # cleanup
        await service.disconnect_ws(jam_id, ws_host)


# ── cross-client command tests ────────────────────────────────────


async def test_cross_client_update_queue(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test that a non-host participant can send update_queue and it updates state for all."""
    from backend._internal import require_auth

    tracks = ["t1", "t2", "t3", "t4"]

    # create jam as host with 4 tracks
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/",
            json={
                "name": "cross client test",
                "track_ids": tracks,
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

        r1 = await _update_queue(client, code, tracks, 1)
        assert r1["state"]["current_index"] == 1
        assert r1["state"]["current_track_id"] == "t2"
        assert r1["state"]["progress_ms"] == 0
        assert r1["state"]["is_playing"] is True

        r2 = await _update_queue(client, code, tracks, 2)
        assert r2["state"]["current_index"] == 2
        assert r2["state"]["current_track_id"] == "t3"

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


async def test_cross_client_update_queue_add_tracks(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test that a non-host participant can extend the queue via update_queue."""
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

        r = await _update_queue(client, code, ["t1", "t2", "t3"], 0)
        assert r["state"]["track_ids"] == ["t1", "t2", "t3"]
        assert r["tracks_changed"] is True


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

    # joiner joins and sends update_queue — output_client_id should be preserved
    async def mock_joiner_auth() -> Session:
        return MockSession(did=second_user)

    app.dependency_overrides[require_auth] = mock_joiner_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        await client.post(f"/jams/{code}/join")

        r = await _update_queue(client, code, ["t1", "t2", "t3"], 1)
        state = r["state"]
        assert state["current_index"] == 1
        assert state["output_client_id"] == "host-client-id"
        assert state["output_did"] == "did:test:host"
        assert state["is_playing"] is True

    # cleanup
    await jam_service.disconnect_ws(jam_id, ws_host)


# ── update_queue edge case tests ──────────────────────────────────


async def test_update_queue_resets_progress_on_track_change(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that progress resets to 0 when current track changes via update_queue."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1", "t2"]})
        code = create_response.json()["code"]
        await client.post(
            f"/jams/{code}/command", json={"type": "seek", "position_ms": 30000}
        )
        r = await _update_queue(client, code, ["t1", "t2"], 1)

    assert r["state"]["current_track_id"] == "t2"
    assert r["state"]["progress_ms"] == 0


async def test_update_queue_preserves_progress_on_same_track(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that progress is preserved when current track stays the same."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1", "t2"]})
        code = create_response.json()["code"]
        await client.post(
            f"/jams/{code}/command", json={"type": "seek", "position_ms": 30000}
        )
        r = await _update_queue(client, code, ["t1", "t2", "t3"], 0)

    assert r["state"]["current_track_id"] == "t1"
    assert r["state"]["progress_ms"] == 30000


async def test_update_queue_clamps_index(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that out-of-bounds current_index is clamped."""
    tracks = ["t1", "t2", "t3"]
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": tracks})
        code = create_response.json()["code"]

        r = await _update_queue(client, code, tracks, 99)
        assert r["state"]["current_index"] == 2
        assert r["state"]["current_track_id"] == "t3"

        r = await _update_queue(client, code, tracks, -5)
        assert r["state"]["current_index"] == 0
        assert r["state"]["current_track_id"] == "t1"

        r = await _update_queue(client, code, [], 0)
        assert r["state"]["current_index"] == 0
        assert r["state"]["current_track_id"] is None


# ── output mode tests ──────────────────────────────────────────────


async def test_set_mode_host_only(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test that only the host can set output mode."""
    from backend._internal import require_auth

    # create jam as host
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]

    # switch to second user
    async def mock_joiner_auth() -> Session:
        return MockSession(did=second_user)

    app.dependency_overrides[require_auth] = mock_joiner_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        await client.post(f"/jams/{code}/join")

        # non-host tries to set mode — should fail
        response = await client.post(
            f"/jams/{code}/command",
            json={"type": "set_mode", "mode": "everyone"},
        )

    assert response.status_code == 400


async def test_set_mode_everyone(test_app: FastAPI, db_session: AsyncSession) -> None:
    """test that host can set mode to everyone and output fields are cleared."""
    from starlette.websockets import WebSocket

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]
        jam_id = create_response.json()["id"]

    # set up host as output device first
    ws = AsyncMock(spec=WebSocket)
    await jam_service.connect_ws(jam_id, ws, "did:test:host")
    jam_service._ws_client_ids[ws] = "host-client"

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        await client.post(
            f"/jams/{code}/command",
            json={"type": "set_output", "client_id": "host-client"},
        )

        # switch to everyone mode
        response = await client.post(
            f"/jams/{code}/command",
            json={"type": "set_mode", "mode": "everyone"},
        )

    assert response.status_code == 200
    state = response.json()["state"]
    assert state["output_mode"] == "everyone"
    assert state["output_client_id"] is None
    assert state["output_did"] is None

    await jam_service.disconnect_ws(jam_id, ws)


async def test_set_mode_back_to_one_speaker(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test round-trip: one_speaker → everyone → one_speaker."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]
        assert create_response.json()["state"]["output_mode"] == "one_speaker"

        # switch to everyone
        r1 = await client.post(
            f"/jams/{code}/command",
            json={"type": "set_mode", "mode": "everyone"},
        )
        assert r1.json()["state"]["output_mode"] == "everyone"

        # switch back to one_speaker
        r2 = await client.post(
            f"/jams/{code}/command",
            json={"type": "set_mode", "mode": "one_speaker"},
        )
        assert r2.json()["state"]["output_mode"] == "one_speaker"


async def test_everyone_mode_skips_output_disconnect_pause(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that in everyone mode, disconnecting a WS does NOT pause playback."""
    from starlette.websockets import WebSocket

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/", json={"track_ids": ["t1"], "is_playing": True}
        )
        code = create_response.json()["code"]
        jam_id = create_response.json()["id"]

        # switch to everyone mode
        await client.post(
            f"/jams/{code}/command",
            json={"type": "set_mode", "mode": "everyone"},
        )

    # connect a WS and then disconnect it
    ws = AsyncMock(spec=WebSocket)
    await jam_service.connect_ws(jam_id, ws, "did:test:host")
    jam_service._ws_client_ids[ws] = "host-client"
    await jam_service.disconnect_ws(jam_id, ws)

    # jam should still be playing
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        get_response = await client.get(f"/jams/{code}")
        state = get_response.json()["state"]
        assert state["is_playing"] is True
        assert state["output_mode"] == "everyone"


async def test_everyone_mode_skips_auto_output(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that in everyone mode, host sync does NOT auto-assign output."""
    from starlette.websockets import WebSocket

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]
        jam_id = create_response.json()["id"]

        # switch to everyone mode
        await client.post(
            f"/jams/{code}/command",
            json={"type": "set_mode", "mode": "everyone"},
        )

    # host connects and sends sync
    ws = AsyncMock(spec=WebSocket)
    await jam_service.connect_ws(jam_id, ws, "did:test:host")
    await jam_service._handle_sync(
        jam_id, "did:test:host", {"client_id": "host-abc", "last_id": None}, ws
    )

    # output_client_id should remain None (not auto-set)
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        get_response = await client.get(f"/jams/{code}")
        state = get_response.json()["state"]
        assert state["output_client_id"] is None
        assert state["output_mode"] == "everyone"

    await jam_service.disconnect_ws(jam_id, ws)


async def test_set_mode_invalid_value(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test that an invalid mode value is rejected."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]

        response = await client.post(
            f"/jams/{code}/command",
            json={"type": "set_mode", "mode": "invalid_mode"},
        )

    assert response.status_code == 400


# ── output fallback tests ──────────────────────────────────────────


async def test_output_fallback_on_disconnect(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test that output reassigns to remaining client when output WS disconnects."""
    from starlette.websockets import WebSocket

    from backend._internal import require_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/", json={"track_ids": ["t1"], "is_playing": True}
        )
        code = create_response.json()["code"]
        jam_id = create_response.json()["id"]

    # second user joins
    async def mock_joiner_auth() -> Session:
        return MockSession(did=second_user)

    app.dependency_overrides[require_auth] = mock_joiner_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        await client.post(f"/jams/{code}/join")

    # restore host auth
    async def mock_host_auth() -> Session:
        return MockSession(did="did:test:host")

    app.dependency_overrides[require_auth] = mock_host_auth

    # connect both WSs
    ws_host = AsyncMock(spec=WebSocket)
    ws_joiner = AsyncMock(spec=WebSocket)
    await jam_service.connect_ws(jam_id, ws_host, "did:test:host")
    jam_service._ws_client_ids[ws_host] = "host-client"
    await jam_service.connect_ws(jam_id, ws_joiner, second_user)
    jam_service._ws_client_ids[ws_joiner] = "joiner-client"

    # set joiner as output device
    app.dependency_overrides[require_auth] = mock_joiner_auth
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        await client.post(
            f"/jams/{code}/command",
            json={"type": "set_output", "client_id": "joiner-client"},
        )

    # disconnect the output device (joiner)
    await jam_service.disconnect_ws(jam_id, ws_joiner)

    # output should have fallen back to host, playback should NOT be paused
    app.dependency_overrides[require_auth] = mock_host_auth
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        get_response = await client.get(f"/jams/{code}")
        state = get_response.json()["state"]
        assert state["output_client_id"] == "host-client"
        assert state["output_did"] == "did:test:host"
        assert state["is_playing"] is True

    await jam_service.disconnect_ws(jam_id, ws_host)


async def test_output_fallback_prefers_host(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test that fallback prefers host over other connected clients."""
    from starlette.websockets import WebSocket

    from backend._internal import require_auth

    # create a third user
    third_did = "did:test:third"
    third_artist = Artist(
        did=third_did,
        handle="test.third",
        display_name="Test Third",
    )
    db_session.add(third_artist)
    await db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/", json={"track_ids": ["t1"], "is_playing": True}
        )
        code = create_response.json()["code"]
        jam_id = create_response.json()["id"]

    # join second and third users
    for did in [second_user, third_did]:

        async def _auth(did: str = did) -> Session:
            return MockSession(did=did)

        app.dependency_overrides[require_auth] = _auth
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            await client.post(f"/jams/{code}/join")

    # connect all three WSs
    ws_host = AsyncMock(spec=WebSocket)
    ws_joiner = AsyncMock(spec=WebSocket)
    ws_third = AsyncMock(spec=WebSocket)
    await jam_service.connect_ws(jam_id, ws_host, "did:test:host")
    jam_service._ws_client_ids[ws_host] = "host-client"
    await jam_service.connect_ws(jam_id, ws_joiner, second_user)
    jam_service._ws_client_ids[ws_joiner] = "joiner-client"
    await jam_service.connect_ws(jam_id, ws_third, third_did)
    jam_service._ws_client_ids[ws_third] = "third-client"

    # set third user as output
    async def mock_third_auth() -> Session:
        return MockSession(did=third_did)

    app.dependency_overrides[require_auth] = mock_third_auth
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        await client.post(
            f"/jams/{code}/command",
            json={"type": "set_output", "client_id": "third-client"},
        )

    # disconnect the output (third user)
    await jam_service.disconnect_ws(jam_id, ws_third)

    # fallback should prefer host over joiner
    async def mock_host_auth() -> Session:
        return MockSession(did="did:test:host")

    app.dependency_overrides[require_auth] = mock_host_auth
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        get_response = await client.get(f"/jams/{code}")
        state = get_response.json()["state"]
        assert state["output_client_id"] == "host-client"
        assert state["output_did"] == "did:test:host"
        assert state["is_playing"] is True

    await jam_service.disconnect_ws(jam_id, ws_host)
    await jam_service.disconnect_ws(jam_id, ws_joiner)


async def test_non_host_auto_output_on_sync(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """test that a non-host gets auto-assigned as output when no output is set."""
    from starlette.websockets import WebSocket

    from backend._internal import require_auth

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"track_ids": ["t1"]})
        code = create_response.json()["code"]
        jam_id = create_response.json()["id"]
        assert create_response.json()["state"]["output_client_id"] is None

    # join as second user
    async def mock_joiner_auth() -> Session:
        return MockSession(did=second_user)

    app.dependency_overrides[require_auth] = mock_joiner_auth
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        await client.post(f"/jams/{code}/join")

    # connect joiner WS and send sync with client_id (no host WS connected)
    ws = AsyncMock(spec=WebSocket)
    await jam_service.connect_ws(jam_id, ws, second_user)
    await jam_service._handle_sync(
        jam_id, second_user, {"client_id": "joiner-abc-123", "last_id": None}, ws
    )

    # verify non-host was auto-assigned as output
    async def mock_host_auth() -> Session:
        return MockSession(did="did:test:host")

    app.dependency_overrides[require_auth] = mock_host_auth
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        get_response = await client.get(f"/jams/{code}")
        state = get_response.json()["state"]
        assert state["output_client_id"] == "joiner-abc-123"
        assert state["output_did"] == second_user

    await jam_service.disconnect_ws(jam_id, ws)


async def test_jam_preview_returns_host_info(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test GET /jams/{code}/preview returns host info without auth."""
    # create jam as authenticated user
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "preview test"})
        code = create_response.json()["code"]

    # clear auth overrides — preview is public
    app.dependency_overrides.clear()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get(f"/jams/{code}/preview")

    assert response.status_code == 200
    data = response.json()
    assert data["code"] == code
    assert data["name"] == "preview test"
    assert data["is_active"] is True
    assert data["host_handle"] == "test.host"
    assert data["host_display_name"] == "Test Host"
    assert data["participant_count"] >= 1


async def test_jam_preview_not_found(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """test GET /jams/{code}/preview returns 404 for nonexistent code."""
    app.dependency_overrides.clear()

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/jams/nonexist/preview")

    assert response.status_code == 404


# ── WebSocket security tests ──────────────────────────────────────


def _assert_ws_close_code(
    exc_info: pytest.ExceptionInfo[WebSocketDisconnect], expected: int
) -> None:
    """assert that a WebSocketDisconnect has the expected close code."""
    assert exc_info.value.code == expected, (
        f"expected close code {expected}, got {exc_info.value.code}"
    )


async def test_ws_rejects_without_session(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """WebSocket without session cookie should be closed with 4001."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "ws auth test"})
        code = create_response.json()["code"]

    with (
        TestClient(test_app) as tc,
        pytest.raises(WebSocketDisconnect) as exc_info,
        tc.websocket_connect(f"/jams/{code}/ws"),
    ):
        pass

    _assert_ws_close_code(exc_info, 4001)


async def test_ws_rejects_invalid_session(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """WebSocket with invalid session cookie should be closed with 4001."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "ws bad session"})
        code = create_response.json()["code"]

    with (
        TestClient(test_app) as tc,
        pytest.raises(WebSocketDisconnect) as exc_info,
        tc.websocket_connect(
            f"/jams/{code}/ws", cookies={"session_id": "totally-fake"}
        ),
    ):
        pass

    _assert_ws_close_code(exc_info, 4001)


async def test_ws_rejects_non_participant(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """WebSocket from authenticated non-participant should be closed with 4003."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/", json={"name": "ws non-participant"}
        )
        code = create_response.json()["code"]

    non_participant = MockSession(did="did:test:outsider")

    with (
        patch("backend.api.jams.get_session", return_value=non_participant),
        TestClient(test_app) as tc,
        pytest.raises(WebSocketDisconnect) as exc_info,
        tc.websocket_connect(
            f"/jams/{code}/ws", cookies={"session_id": "mock-session"}
        ),
    ):
        pass

    _assert_ws_close_code(exc_info, 4003)


async def test_ws_rejects_bad_origin(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """WebSocket with wrong Origin header should be closed with 4002."""
    from backend.config import settings

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "ws origin test"})
        code = create_response.json()["code"]

    host_session = MockSession(did="did:test:host")

    with (
        patch("backend.api.jams.get_session", return_value=host_session),
        patch.object(settings.app, "debug", False),
        TestClient(test_app) as tc,
        pytest.raises(WebSocketDisconnect) as exc_info,
        tc.websocket_connect(
            f"/jams/{code}/ws",
            cookies={"session_id": "mock-session"},
            headers={"origin": "https://evil.example.com"},
        ),
    ):
        pass

    _assert_ws_close_code(exc_info, 4002)


async def test_ws_accepts_valid_origin(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """WebSocket with correct Origin header should connect successfully."""
    from backend.config import settings

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "ws valid origin"})
        code = create_response.json()["code"]

    host_session = MockSession(did="did:test:host")

    with (
        patch("backend.api.jams.get_session", return_value=host_session),
        patch.object(settings.app, "debug", False),
        TestClient(test_app) as tc,
        tc.websocket_connect(
            f"/jams/{code}/ws",
            cookies={"session_id": "mock-session"},
            headers={"origin": settings.frontend.url},
        ) as ws,
    ):
        ws.send_json({"type": "ping"})
        response = ws.receive_json()
        assert response["type"] == "pong"


async def test_ws_ping_pong(test_app: FastAPI, db_session: AsyncSession) -> None:
    """WebSocket ping message should return pong."""
    from backend.config import settings

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "ws ping"})
        code = create_response.json()["code"]

    host_session = MockSession(did="did:test:host")

    with (
        patch("backend.api.jams.get_session", return_value=host_session),
        TestClient(test_app) as tc,
        tc.websocket_connect(
            f"/jams/{code}/ws",
            cookies={"session_id": "mock-session"},
            headers={"origin": settings.frontend.url},
        ) as ws,
    ):
        ws.send_json({"type": "ping"})
        response = ws.receive_json()
        assert response["type"] == "pong"


async def test_ws_sync_returns_state(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """sync message should return full jam state snapshot."""
    from backend.config import settings

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/", json={"name": "ws sync", "track_ids": ["t1", "t2"]}
        )
        code = create_response.json()["code"]

    host_session = MockSession(did="did:test:host")

    with (
        patch("backend.api.jams.get_session", return_value=host_session),
        TestClient(test_app) as tc,
        tc.websocket_connect(
            f"/jams/{code}/ws",
            cookies={"session_id": "mock-session"},
            headers={"origin": settings.frontend.url},
        ) as ws,
    ):
        ws.send_json({"type": "sync", "last_id": None, "client_id": "test-client"})
        response = ws.receive_json()
        assert response["type"] == "state"
        assert response["state"]["track_ids"] == ["t1", "t2"]
        assert "revision" in response


async def test_exchange_omits_session_id_for_browser(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """browser exchange should omit session_id from body (delivered via cookie)."""
    with patch(
        "backend.api.auth.consume_exchange_token",
        return_value=("real-session-id-123", False),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/auth/exchange",
                json={"exchange_token": "test-token"},
                headers={"user-agent": "Mozilla/5.0 Chrome/120"},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["session_id"] is None
    # cookie should still be set
    assert "session_id" in response.cookies


async def test_exchange_returns_session_id_for_non_browser(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """non-browser exchange should return real session_id."""
    with patch(
        "backend.api.auth.consume_exchange_token",
        return_value=("real-session-id-456", False),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/auth/exchange",
                json={"exchange_token": "test-token"},
                headers={"user-agent": "plyr-sdk/1.0"},
            )

    assert response.status_code == 200
    data = response.json()
    assert data["session_id"] == "real-session-id-456"


def test_is_allowed_ws_origin_valid() -> None:
    """origin matching frontend URL should be allowed."""
    from starlette.websockets import WebSocket

    from backend.api.jams import _is_allowed_ws_origin
    from backend.config import settings

    ws = AsyncMock(spec=WebSocket)
    ws.headers = {"origin": settings.frontend.url}

    with patch.object(settings.app, "debug", False):
        assert _is_allowed_ws_origin(ws) is True


def test_is_allowed_ws_origin_rejected() -> None:
    """origin not matching frontend URL should be rejected."""
    from starlette.websockets import WebSocket

    from backend.api.jams import _is_allowed_ws_origin
    from backend.config import settings

    ws = AsyncMock(spec=WebSocket)
    ws.headers = {"origin": "https://evil.example.com"}

    with patch.object(settings.app, "debug", False):
        assert _is_allowed_ws_origin(ws) is False


def test_is_allowed_ws_origin_missing_in_debug() -> None:
    """missing origin should be allowed in debug mode."""
    from starlette.websockets import WebSocket

    from backend.api.jams import _is_allowed_ws_origin
    from backend.config import settings

    ws = AsyncMock(spec=WebSocket)
    ws.headers = {}

    with patch.object(settings.app, "debug", True):
        assert _is_allowed_ws_origin(ws) is True


def test_is_allowed_ws_origin_missing_in_prod() -> None:
    """missing origin should be rejected in production."""
    from starlette.websockets import WebSocket

    from backend.api.jams import _is_allowed_ws_origin
    from backend.config import settings

    ws = AsyncMock(spec=WebSocket)
    ws.headers = {}

    with patch.object(settings.app, "debug", False):
        assert _is_allowed_ws_origin(ws) is False


# ── WebSocket reliability tests ────────────────────────────────────


async def test_ws_idle_timeout(test_app: FastAPI, db_session: AsyncSession) -> None:
    """connection should be closed with 4008 after idle timeout."""
    from backend.config import settings

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "ws idle"})
        code = create_response.json()["code"]

    host_session = MockSession(did="did:test:host")

    with (
        patch("backend.api.jams.get_session", return_value=host_session),
        patch("backend.api.jams.IDLE_TIMEOUT_SECONDS", 0.1),
        TestClient(test_app) as tc,
        pytest.raises(WebSocketDisconnect, match="4008"),
        tc.websocket_connect(
            f"/jams/{code}/ws",
            cookies={"session_id": "mock-session"},
            headers={"origin": settings.frontend.url},
        ) as ws,
    ):
        # don't send anything — let the timeout fire
        ws.receive_json()  # should get the close frame


async def test_ws_rate_limit(test_app: FastAPI, db_session: AsyncSession) -> None:
    """spamming messages beyond limit should return rate limit error."""
    from backend._internal.jams import MAX_MESSAGES_PER_SECOND
    from backend.config import settings

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "ws rate limit"})
        code = create_response.json()["code"]

    host_session = MockSession(did="did:test:host")

    with (
        patch("backend.api.jams.get_session", return_value=host_session),
        TestClient(test_app) as tc,
        tc.websocket_connect(
            f"/jams/{code}/ws",
            cookies={"session_id": "mock-session"},
            headers={"origin": settings.frontend.url},
        ) as ws,
    ):
        # spam pings beyond the limit
        for _ in range(MAX_MESSAGES_PER_SECOND + 5):
            ws.send_json({"type": "ping"})

        # collect all responses — at least one should be a rate limit error
        responses = []
        for _ in range(MAX_MESSAGES_PER_SECOND + 5):
            responses.append(ws.receive_json())

        rate_limited = [
            r for r in responses if r.get("message") == "rate limit exceeded"
        ]
        assert len(rate_limited) > 0


async def test_ws_connection_limit(
    test_app: FastAPI, db_session: AsyncSession, second_user: str
) -> None:
    """exceeding max connections should close with 4009."""
    from backend.config import settings

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "ws conn limit"})
        code = create_response.json()["code"]

    host_session = MockSession(did="did:test:host")

    # set limit to 1 so the second connection fails
    ws_url = f"/jams/{code}/ws"
    ws_kwargs: dict[str, Any] = {
        "cookies": {"session_id": "mock-session"},
        "headers": {"origin": settings.frontend.url},
    }

    with (
        patch("backend.api.jams.get_session", return_value=host_session),
        patch("backend.api.jams.MAX_CONNECTIONS_PER_JAM", 1),
        TestClient(test_app) as tc,
        tc.websocket_connect(ws_url, **ws_kwargs),
        # second connection should fail
        pytest.raises(WebSocketDisconnect, match="4009"),
        tc.websocket_connect(ws_url, **ws_kwargs),
    ):
        pass


async def test_ws_invalid_json(test_app: FastAPI, db_session: AsyncSession) -> None:
    """non-JSON message should return error."""
    from backend.config import settings

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "ws bad json"})
        code = create_response.json()["code"]

    host_session = MockSession(did="did:test:host")

    with (
        patch("backend.api.jams.get_session", return_value=host_session),
        TestClient(test_app) as tc,
        tc.websocket_connect(
            f"/jams/{code}/ws",
            cookies={"session_id": "mock-session"},
            headers={"origin": settings.frontend.url},
        ) as ws,
    ):
        ws.send_text("not json at all{{{")
        response = ws.receive_json()
        assert response["type"] == "error"
        assert "invalid JSON" in response["message"]


async def test_ws_invalid_message_format(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """valid JSON but bad shape should return error."""
    from backend.config import settings

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post("/jams/", json={"name": "ws bad shape"})
        code = create_response.json()["code"]

    host_session = MockSession(did="did:test:host")

    with (
        patch("backend.api.jams.get_session", return_value=host_session),
        TestClient(test_app) as tc,
        tc.websocket_connect(
            f"/jams/{code}/ws",
            cookies={"session_id": "mock-session"},
            headers={"origin": settings.frontend.url},
        ) as ws,
    ):
        # missing required "type" field
        ws.send_json({"payload": {"foo": "bar"}})
        response = ws.receive_json()
        assert response["type"] == "error"
        assert "invalid message format" in response["message"]


async def test_ws_command_round_trip(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """send a command via WS and receive state update."""
    from backend.config import settings

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        create_response = await client.post(
            "/jams/",
            json={
                "name": "ws round trip",
                "track_ids": ["track1", "track2"],
                "is_playing": False,
            },
        )
        code = create_response.json()["code"]

    host_session = MockSession(did="did:test:host")

    with (
        patch("backend.api.jams.get_session", return_value=host_session),
        TestClient(test_app) as tc,
        tc.websocket_connect(
            f"/jams/{code}/ws",
            cookies={"session_id": "mock-session"},
            headers={"origin": settings.frontend.url},
        ) as ws,
    ):
        # sync first to get initial state
        ws.send_json({"type": "sync", "last_id": None, "client_id": "test-client"})
        sync_response = ws.receive_json()
        assert sync_response["type"] == "state"
        assert sync_response["state"]["is_playing"] is False

        # send play command via WS
        ws.send_json({"type": "command", "payload": {"type": "play"}})
        # receive the state update broadcast
        state_response = ws.receive_json()
        assert state_response["type"] == "state"
        assert state_response["state"]["is_playing"] is True
