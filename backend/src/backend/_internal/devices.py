"""device presence service for cross-session playback awareness.

manages per-user device lists, WebSocket connections, and Redis Streams
for real-time device presence sync across browser sessions.
"""

import asyncio
import contextlib
import json
import logging
import time
from typing import Any

from fastapi import WebSocket

from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

# Redis hash TTL for device entries (auto-expire stale devices)
DEVICE_TTL_SECONDS = 120
# how often clients should heartbeat
HEARTBEAT_INTERVAL_SECONDS = 30


class DeviceService:
    """service for tracking device presence with Redis + WebSocket fan-out."""

    def __init__(self) -> None:
        self._connections: dict[str, dict[str, WebSocket]] = {}  # did → {device_id: ws}
        self._reader_tasks: dict[str, asyncio.Task[None]] = {}  # did → stream reader

    async def setup(self) -> None:
        """initialize the device service."""
        logger.info("starting device service")

    async def shutdown(self) -> None:
        """cleanup resources."""
        logger.info("shutting down device service")
        for _did, task in self._reader_tasks.items():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._reader_tasks.clear()
        self._connections.clear()

    # ── device lifecycle ──────────────────────────────────────────

    async def register_device(
        self,
        did: str,
        device_id: str,
        name: str,
        ws: WebSocket,
    ) -> None:
        """register a device WebSocket and broadcast updated device list."""
        if did not in self._connections:
            self._connections[did] = {}
        self._connections[did][device_id] = ws

        # write device entry to Redis hash
        redis = get_async_redis_client()
        key = f"plyr:devices:{did}"
        entry = json.dumps(
            {
                "device_id": device_id,
                "name": name,
                "is_playing": False,
                "current_track_id": None,
                "progress_ms": 0,
                "last_seen": int(time.time() * 1000),
            }
        )
        await redis.hset(key, device_id, entry)  # type: ignore[misc]
        await redis.expire(key, DEVICE_TTL_SECONDS)

        # start stream reader if first device for this user
        if did not in self._reader_tasks or self._reader_tasks[did].done():
            self._reader_tasks[did] = asyncio.create_task(self._stream_reader(did))
            logger.info("started device stream reader for %s", did)

        await self._broadcast_devices(did)

    async def unregister_device(self, did: str, device_id: str) -> None:
        """remove a device and broadcast updated list."""
        # remove WS
        if did in self._connections:
            self._connections[did].pop(device_id, None)
            if not self._connections[did]:
                del self._connections[did]

        # remove from Redis hash
        try:
            redis = get_async_redis_client()
            await redis.hdel(f"plyr:devices:{did}", device_id)  # type: ignore[misc]
        except Exception:
            logger.exception(
                "failed to remove device from Redis: %s/%s", did, device_id
            )

        # broadcast updated list
        await self._broadcast_devices(did)

        # cancel reader if no more connections for this user
        if did not in self._connections and did in self._reader_tasks:
            self._reader_tasks[did].cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._reader_tasks[did]
            del self._reader_tasks[did]
            logger.info("stopped device stream reader for %s", did)

    async def heartbeat(
        self,
        did: str,
        device_id: str,
        is_playing: bool = False,
        current_track_id: str | None = None,
        progress_ms: int = 0,
    ) -> None:
        """update device state in Redis and refresh TTL."""
        redis = get_async_redis_client()
        key = f"plyr:devices:{did}"

        # read existing entry to preserve name
        raw = await redis.hget(key, device_id)  # type: ignore[misc]
        if not raw:
            return
        existing = json.loads(raw)

        entry = json.dumps(
            {
                "device_id": device_id,
                "name": existing.get("name", "unknown device"),
                "is_playing": is_playing,
                "current_track_id": current_track_id,
                "progress_ms": progress_ms,
                "last_seen": int(time.time() * 1000),
            }
        )
        await redis.hset(key, device_id, entry)  # type: ignore[misc]
        await redis.expire(key, DEVICE_TTL_SECONDS)

        await self._broadcast_devices(did)

    async def get_devices(self, did: str) -> list[dict[str, Any]]:
        """get all registered devices for a user."""
        redis = get_async_redis_client()
        raw_entries = await redis.hgetall(f"plyr:devices:{did}")  # type: ignore[misc]
        devices: list[dict[str, Any]] = []
        for _device_id, raw in raw_entries.items():
            try:
                devices.append(json.loads(raw))
            except (json.JSONDecodeError, TypeError):
                continue
        return devices

    # ── transfer ──────────────────────────────────────────────────

    async def handle_transfer(
        self,
        did: str,
        source_device_id: str,
        target_device_id: str,
    ) -> bool:
        """transfer playback from source to target device.

        reads queue state from Postgres, interpolates progress,
        and sends transfer_out / transfer_in messages.
        """
        from sqlalchemy import select

        from backend._internal.queue import queue_service
        from backend.models.queue import QueueState
        from backend.utilities.database import db_session

        # get queue state from DB
        async with db_session() as db:
            result = await db.execute(select(QueueState).where(QueueState.did == did))
            queue_row = result.scalar_one_or_none()
            if not queue_row:
                return False

            state = queue_row.state
            updated_at = queue_row.updated_at

        # hydrate tracks via queue service
        queue_data = await queue_service.get_queue(did)
        tracks = queue_data[2] if queue_data else []

        # interpolate progress
        progress_ms = state.get("progress_ms", 0)
        # if the source was playing, add elapsed time since last update
        source_devices = await self.get_devices(did)
        source_device = next(
            (d for d in source_devices if d["device_id"] == source_device_id), None
        )
        if source_device and source_device.get("is_playing") and updated_at:
            elapsed = int((time.time() - updated_at.timestamp()) * 1000)
            progress_ms += elapsed

        snapshot = {
            "state": state,
            "tracks": tracks,
            "progress_ms": progress_ms,
        }

        # publish transfer_out to source
        await self._send_to_device(
            did,
            source_device_id,
            {
                "type": "transfer_out",
            },
        )

        # publish transfer_in to target
        await self._send_to_device(
            did,
            target_device_id,
            {
                "type": "transfer_in",
                **snapshot,
            },
        )

        return True

    # ── WebSocket message handling ────────────────────────────────

    async def handle_ws_message(
        self,
        did: str,
        device_id: str,
        message: dict[str, Any],
        ws: WebSocket,
    ) -> None:
        """process an incoming WebSocket message from a device."""
        msg_type = message.get("type")

        if msg_type == "register":
            name = message.get("name", "unknown device")
            await self.register_device(did, device_id, name, ws)
        elif msg_type == "heartbeat":
            await self.heartbeat(
                did,
                device_id,
                is_playing=message.get("is_playing", False),
                current_track_id=message.get("current_track_id"),
                progress_ms=message.get("progress_ms", 0),
            )
        elif msg_type == "transfer":
            target_device_id = message.get("target_device_id")
            if target_device_id:
                success = await self.handle_transfer(did, device_id, target_device_id)
                if not success:
                    await ws.send_json({"type": "error", "message": "transfer failed"})
        elif msg_type == "ping":
            await ws.send_json({"type": "pong"})
        else:
            await ws.send_json(
                {"type": "error", "message": f"unknown message type: {msg_type}"}
            )

    # ── Redis Streams ─────────────────────────────────────────────

    async def _publish_event(self, did: str, event: dict[str, Any]) -> None:
        """publish an event to the user's device stream."""
        try:
            redis = get_async_redis_client()
            stream_key = f"plyr:devices:{did}:events"
            await redis.xadd(
                stream_key,
                {"payload": json.dumps(event)},
                maxlen=100,
                approximate=True,
            )
        except Exception:
            logger.exception("failed to publish device event for %s", did)

    async def _stream_reader(self, did: str) -> None:
        """background task that reads from a user's device stream and fans out."""
        redis = get_async_redis_client()
        stream_key = f"plyr:devices:{did}:events"
        last_id = "$"

        while True:
            try:
                results = await redis.xread({stream_key: last_id}, block=5000, count=10)
                for _, messages in results or []:
                    for msg_id, data in messages:
                        last_id = msg_id
                        payload = json.loads(data.get("payload", "{}"))
                        await self._fan_out(did, payload)
            except asyncio.CancelledError:
                logger.info("device stream reader cancelled for %s", did)
                break
            except Exception:
                logger.exception("error in device stream reader for %s", did)
                await asyncio.sleep(1)

    async def _fan_out(self, did: str, payload: dict[str, Any]) -> None:
        """send a message to all connected device WebSockets for a user."""
        connections = self._connections.get(did, {})
        dead: list[str] = []

        for device_id, ws in connections.items():
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(device_id)

        for device_id in dead:
            connections.pop(device_id, None)

    async def _send_to_device(
        self, did: str, device_id: str, message: dict[str, Any]
    ) -> None:
        """send a message to a specific device WebSocket."""
        connections = self._connections.get(did, {})
        ws = connections.get(device_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                logger.exception("failed to send to device %s/%s", did, device_id)

    async def _broadcast_devices(self, did: str) -> None:
        """broadcast the current device list to all connected devices for a user."""
        devices = await self.get_devices(did)
        await self._publish_event(
            did,
            {
                "type": "devices_updated",
                "devices": devices,
            },
        )


# global instance
device_service = DeviceService()
