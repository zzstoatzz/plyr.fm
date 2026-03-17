"""tests for device presence api endpoints."""

from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocket

from backend._internal import Session
from backend._internal.devices import device_service
from backend.main import app
from backend.models import Artist


class MockSession(Session):
    """mock session for auth bypass in tests."""

    def __init__(self, did: str = "did:test:user1"):
        self.did = did
        self.access_token = "test_token"
        self.refresh_token = "test_refresh"
        self.session_id = "test_session"
        self.handle = "test.user1"
        self.oauth_session = {}


@pytest.fixture
async def test_app(db_session: AsyncSession) -> AsyncGenerator[FastAPI, None]:
    """create test app with mocked auth."""
    from backend._internal import require_auth

    mock_session = MockSession()

    async def mock_require_auth() -> Session:
        return mock_session

    app.dependency_overrides[require_auth] = mock_require_auth

    artist = Artist(
        did="did:test:user1",
        handle="test.user1",
        display_name="Test User",
    )
    db_session.add(artist)
    await db_session.commit()

    yield app

    app.dependency_overrides.clear()


async def test_list_devices_empty(test_app: FastAPI) -> None:
    """GET /devices/ returns empty list when no devices registered."""
    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/devices/")

    assert response.status_code == 200
    assert response.json() == []


async def test_device_register_via_service(test_app: FastAPI) -> None:
    """registering a device makes it appear in the device list."""
    ws = AsyncMock(spec=WebSocket)

    with patch.object(device_service, "_broadcast_devices", new_callable=AsyncMock):
        await device_service.register_device(
            "did:test:user1", "device-aaa", "Chrome on macOS", ws
        )

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/devices/")

    assert response.status_code == 200
    devices = response.json()
    assert len(devices) == 1
    assert devices[0]["device_id"] == "device-aaa"
    assert devices[0]["name"] == "Chrome on macOS"
    assert devices[0]["is_playing"] is False

    # cleanup
    with patch.object(device_service, "_broadcast_devices", new_callable=AsyncMock):
        await device_service.unregister_device("did:test:user1", "device-aaa")


async def test_multiple_devices_same_user(test_app: FastAPI) -> None:
    """multiple devices for the same user all appear in the list."""
    ws1 = AsyncMock(spec=WebSocket)
    ws2 = AsyncMock(spec=WebSocket)

    with patch.object(device_service, "_broadcast_devices", new_callable=AsyncMock):
        await device_service.register_device(
            "did:test:user1", "device-aaa", "Chrome on macOS", ws1
        )
        await device_service.register_device(
            "did:test:user1", "device-bbb", "Safari on iPhone", ws2
        )

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/devices/")

    assert response.status_code == 200
    devices = response.json()
    assert len(devices) == 2
    device_ids = {d["device_id"] for d in devices}
    assert device_ids == {"device-aaa", "device-bbb"}

    # cleanup
    with patch.object(device_service, "_broadcast_devices", new_callable=AsyncMock):
        await device_service.unregister_device("did:test:user1", "device-aaa")
        await device_service.unregister_device("did:test:user1", "device-bbb")


async def test_device_unregister_on_disconnect(test_app: FastAPI) -> None:
    """unregistering a device removes it from the list."""
    ws = AsyncMock(spec=WebSocket)

    with patch.object(device_service, "_broadcast_devices", new_callable=AsyncMock):
        await device_service.register_device(
            "did:test:user1", "device-aaa", "Chrome on macOS", ws
        )
        await device_service.unregister_device("did:test:user1", "device-aaa")

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/devices/")

    assert response.status_code == 200
    assert response.json() == []


async def test_heartbeat_updates_state(test_app: FastAPI) -> None:
    """heartbeat updates the device's playback state."""
    ws = AsyncMock(spec=WebSocket)

    with patch.object(device_service, "_broadcast_devices", new_callable=AsyncMock):
        await device_service.register_device(
            "did:test:user1", "device-aaa", "Chrome on macOS", ws
        )
        await device_service.heartbeat(
            "did:test:user1",
            "device-aaa",
            is_playing=True,
            current_track_id="track-123",
            progress_ms=42000,
        )

    async with AsyncClient(
        transport=ASGITransport(app=test_app), base_url="http://test"
    ) as client:
        response = await client.get("/devices/")

    assert response.status_code == 200
    devices = response.json()
    assert len(devices) == 1
    assert devices[0]["is_playing"] is True
    assert devices[0]["current_track_id"] == "track-123"
    assert devices[0]["progress_ms"] == 42000

    # cleanup
    with patch.object(device_service, "_broadcast_devices", new_callable=AsyncMock):
        await device_service.unregister_device("did:test:user1", "device-aaa")


async def test_transfer_sends_to_devices(
    test_app: FastAPI, db_session: AsyncSession
) -> None:
    """transfer sends transfer_out to source and transfer_in to target."""
    from backend.models.queue import QueueState as QueueStateModel

    # create queue state in DB for this user
    queue_row = QueueStateModel(
        did="did:test:user1",
        state={
            "track_ids": ["track-1", "track-2"],
            "current_index": 0,
            "current_track_id": "track-1",
            "shuffle": False,
            "original_order_ids": ["track-1", "track-2"],
            "progress_ms": 10000,
        },
        revision=1,
    )
    db_session.add(queue_row)
    await db_session.commit()

    ws_source = AsyncMock(spec=WebSocket)
    ws_target = AsyncMock(spec=WebSocket)

    with patch.object(device_service, "_broadcast_devices", new_callable=AsyncMock):
        await device_service.register_device(
            "did:test:user1", "device-src", "Chrome on macOS", ws_source
        )
        await device_service.register_device(
            "did:test:user1", "device-tgt", "Safari on iPhone", ws_target
        )

    # patch _send_to_device to capture calls (spec'd WS mocks + send_json can be tricky)
    sent_messages: list[tuple[str, dict]] = []

    async def capture_send(did: str, device_id: str, message: dict) -> None:
        sent_messages.append((device_id, message))

    with patch.object(device_service, "_send_to_device", side_effect=capture_send):
        success = await device_service.handle_transfer(
            "did:test:user1", "device-src", "device-tgt"
        )

    assert success is True

    # source should receive transfer_out
    source_msgs = [m for did, m in sent_messages if did == "device-src"]
    assert any(m.get("type") == "transfer_out" for m in source_msgs)

    # target should receive transfer_in with queue state
    target_msgs = [m for did, m in sent_messages if did == "device-tgt"]
    transfer_in = next((m for m in target_msgs if m.get("type") == "transfer_in"), None)
    assert transfer_in is not None
    assert "state" in transfer_in

    # cleanup
    with patch.object(device_service, "_broadcast_devices", new_callable=AsyncMock):
        await device_service.unregister_device("did:test:user1", "device-src")
        await device_service.unregister_device("did:test:user1", "device-tgt")


async def test_transfer_blocked_no_queue(test_app: FastAPI) -> None:
    """transfer fails gracefully when user has no queue state."""
    ws_source = AsyncMock(spec=WebSocket)
    ws_target = AsyncMock(spec=WebSocket)

    with patch.object(device_service, "_broadcast_devices", new_callable=AsyncMock):
        await device_service.register_device(
            "did:test:user1", "device-src", "Chrome", ws_source
        )
        await device_service.register_device(
            "did:test:user1", "device-tgt", "Safari", ws_target
        )

    success = await device_service.handle_transfer(
        "did:test:user1", "device-src", "device-tgt"
    )
    assert success is False

    # cleanup
    with patch.object(device_service, "_broadcast_devices", new_callable=AsyncMock):
        await device_service.unregister_device("did:test:user1", "device-src")
        await device_service.unregister_device("did:test:user1", "device-tgt")
