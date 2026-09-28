"""Radio presence against real sessions, Redis, and WebSocket connections."""

import json
import time
from collections.abc import AsyncGenerator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketDisconnect

from backend._internal.auth.session import create_session, delete_session
from backend.api.radio.presence import (
    PRESENCE_TTL,
    listener_ids,
    presence_key,
    remove_listener,
    touch_listener,
)
from backend.config import settings
from backend.main import app
from backend.models import Artist
from backend.utilities.redis import get_async_redis_client


@pytest.fixture(autouse=True)
async def clean_presence() -> AsyncGenerator[None, None]:
    redis = get_async_redis_client()
    keys = [presence_key(station) for station in ("loved", "fresh")]
    await redis.delete(*keys)
    yield
    await redis.delete(*keys)


async def test_presence_deduplicates_accounts_and_isolates_stations() -> None:
    first = json.dumps(["did:plc:listener", str(uuid4())])
    second = json.dumps(["did:plc:listener", str(uuid4())])
    guest = json.dumps([None, str(uuid4())])
    await touch_listener("loved", first)
    await touch_listener("loved", second)
    await touch_listener("loved", guest)
    assert await listener_ids("loved") == (2, ["did:plc:listener"])
    assert await listener_ids("fresh") == (0, [])
    await remove_listener("loved", first)
    assert await listener_ids("loved") == (2, ["did:plc:listener"])
    await remove_listener("loved", second)
    assert await listener_ids("loved") == (1, [])


async def test_presence_expires_after_a_crashed_process() -> None:
    member = json.dumps(["did:plc:old", str(uuid4())])
    redis = get_async_redis_client()
    await redis.zadd(presence_key("loved"), {member: time.time() - PRESENCE_TTL - 1})
    assert await listener_ids("loved") == (0, [])
    assert await redis.zcard(presence_key("loved")) == 0


async def test_session_identity_and_disconnect(db_session: AsyncSession) -> None:
    did = "did:plc:radio-listener"
    db_session.add(Artist(did=did, handle="listener.test", display_name="Listener"))
    await db_session.commit()
    session_id = await create_session(did, "listener.test", {})
    with TestClient(app) as client:
        client.cookies.set("session_id", session_id)
        with client.websocket_connect(
            "/radio/loved/listen", headers={"origin": settings.frontend.url}
        ) as ws:
            assert ws.receive_json() == {"type": "listening"}
            response = client.get("/radio/loved/listeners")
            assert response.status_code == 200
            assert response.json()["count"] == 1
            assert response.json()["listeners"][0]["did"] == did
            ws.send_text("ping")
            assert ws.receive_json() == {"type": "listening"}
        assert client.get("/radio/loved/listeners").json()["count"] == 0


async def test_guest_cannot_claim_a_did(db_session: AsyncSession) -> None:
    with TestClient(app) as client:
        with client.websocket_connect(
            "/radio/loved/listen", headers={"origin": settings.frontend.url}
        ) as ws:
            ws.receive_json()
            assert client.get("/radio/loved/listeners").json() == {
                "count": 1,
                "listeners": [],
            }
            ws.send_text(json.dumps({"did": "did:plc:someone-else"}))
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 1008
        assert client.get("/radio/loved/listeners").json()["count"] == 0


@pytest.mark.parametrize(
    ("path", "origin"),
    [
        ("/radio/loved/listen", "https://untrusted.test"),
        ("/radio/unknown/listen", None),
    ],
)
def test_rejects_untrusted_origin_and_unknown_station(
    path: str, origin: str | None
) -> None:
    with (
        TestClient(app) as client,
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(
            path, headers={"origin": origin or settings.frontend.url}
        ),
    ):
        pytest.fail("untrusted connection accepted")


async def test_revoked_session_loses_presence(db_session: AsyncSession) -> None:
    did = "did:plc:revoked-listener"
    db_session.add(Artist(did=did, handle="revoked.test", display_name="Revoked"))
    await db_session.commit()
    session_id = await create_session(did, "revoked.test", {})
    with TestClient(app) as client:
        client.cookies.set("session_id", session_id)
        with client.websocket_connect(
            "/radio/loved/listen", headers={"origin": settings.frontend.url}
        ) as ws:
            ws.receive_json()
            await delete_session(session_id)
            ws.send_text("ping")
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 4001
        assert client.get("/radio/loved/listeners").json()["count"] == 0


def test_invalid_cookie_closes_after_accept() -> None:
    with TestClient(app) as client:
        client.cookies.set("session_id", "expired-radio-session")
        with client.websocket_connect(
            "/radio/loved/listen", headers={"origin": settings.frontend.url}
        ) as ws:
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 4001
