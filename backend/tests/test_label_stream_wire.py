import asyncio
from typing import Any

import httpx
import orjson
import pytest
from libipld import encode_dag_cbor
from sqlalchemy.ext.asyncio import AsyncSession
from websockets.asyncio.server import ServerConnection, serve

from backend._internal.clients import moderation
from backend._internal.label_stream import LabelStreamConsumer
from backend.config import settings
from backend.models import Artist, Track
from backend.utilities.redis import get_async_redis_client


def frame(header: dict[str, Any], body: dict[str, Any]) -> bytes:
    return encode_dag_cbor(header) + encode_dag_cbor(body)


@pytest.mark.parametrize("binary", [False, True])
async def test_wire_event_invalidates_cache_and_reconciles_projection(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch, binary: bool
) -> None:
    uri = "at://did:plc:wire/fm.plyr.track/one"
    db_session.add(Artist(did="did:plc:wire", handle="wire.test", display_name="Wire"))
    await db_session.flush()
    track = Track(
        title="Wire",
        file_id="wire",
        file_type="mp3",
        artist_did="did:plc:wire",
        atproto_record_uri=uri,
        operator_labels=[],
    )
    db_session.add(track)
    await db_session.commit()
    client = moderation.ModerationClient(
        service_url="https://moderation.test",
        labeler_url="https://moderation.test",
        auth_token="test-token",
        timeout_seconds=5,
        label_cache_prefix="wire:",
        label_cache_ttl_seconds=60,
    )
    monkeypatch.setattr(moderation, "_client", client)
    original_client = httpx.AsyncClient

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/internal/labels-by-value":
            return httpx.Response(200, json={"labels": {uri: ["sexual"]}})
        assert request.url.path == "/internal/overrides"
        return httpx.Response(200, json={"overrides": {}})

    class HttpClient(original_client):
        def __init__(self, **kwargs: Any) -> None:
            super().__init__(transport=httpx.MockTransport(respond), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", HttpClient)
    redis = get_async_redis_client()
    await redis.set(f"wire:{uri}", "false")
    await redis.set(f"wire:values:{uri}", "[]")
    payload = {"seq": 7, "labels": [{"uri": uri, "val": "sexual", "neg": False}]}
    raw = (
        frame({"op": 1, "t": "#labels"}, payload)
        if binary
        else orjson.dumps(payload).decode()
    )

    async def send(ws: ServerConnection) -> None:
        await ws.send(raw)
        await ws.close()

    consumer = LabelStreamConsumer()
    async with serve(send, "127.0.0.1", 0) as server:
        assert server.sockets is not None
        port = next(iter(server.sockets)).getsockname()[1]
        monkeypatch.setattr(
            settings.moderation, "label_stream_url", f"ws://127.0.0.1:{port}"
        )
        await asyncio.wait_for(consumer._connect_and_consume(), 5)
    assert consumer._cursor == 7
    assert await redis.get(f"wire:{uri}") is None
    assert await redis.get(f"wire:values:{uri}") is None
    assert await redis.get(settings.moderation.label_stream_cursor_key) == "7"
    await db_session.refresh(track)
    assert track.operator_labels == ["sexual"]


@pytest.mark.parametrize(
    "raw",
    [
        b"invalid cbor",
        "not json",
        "[]",
        frame({"op": -1}, {"error": "FutureCursor"}),
        frame({"op": 1, "t": "#labels"}, {"seq": 99, "labels": [{"val": "sexual"}]}),
        frame({"op": 1, "t": "#labels"}, {"seq": True, "labels": []}),
        encode_dag_cbor({"op": 1, "t": "#labels"}),
    ],
)
async def test_invalid_frame_closes_connection_without_advancing_cursor(
    monkeypatch: pytest.MonkeyPatch, raw: str | bytes
) -> None:
    async def send(ws: ServerConnection) -> None:
        await ws.send(raw)
        await ws.send(frame({"op": 1, "t": "#labels"}, {"seq": 100, "labels": []}))
        await ws.close()

    consumer = LabelStreamConsumer()
    consumer._cursor = 6
    async with serve(send, "127.0.0.1", 0) as server:
        assert server.sockets is not None
        port = next(iter(server.sockets)).getsockname()[1]
        monkeypatch.setattr(
            settings.moderation, "label_stream_url", f"ws://127.0.0.1:{port}"
        )
        with pytest.raises(ValueError):
            await asyncio.wait_for(consumer._connect_and_consume(), 5)
    assert consumer._cursor == 6


async def test_info_and_unknown_frames_allow_following_label_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def send(ws: ServerConnection) -> None:
        for header, body in [
            ({"op": 1, "t": "#info"}, {"name": "OutdatedCursor"}),
            ({"op": 20}, {}),
            ({"op": 1, "t": "#future"}, {"seq": 900}),
            ({"op": 1, "t": "#labels"}, {"seq": 7, "labels": []}),
        ]:
            await ws.send(frame(header, body))
        await ws.close()

    consumer = LabelStreamConsumer()
    async with serve(send, "127.0.0.1", 0) as server:
        assert server.sockets is not None
        port = next(iter(server.sockets)).getsockname()[1]
        monkeypatch.setattr(
            settings.moderation, "label_stream_url", f"ws://127.0.0.1:{port}"
        )
        await asyncio.wait_for(consumer._connect_and_consume(), 5)
    assert consumer._cursor == 7
