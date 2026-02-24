"""Redis Streams input for Osprey.

reads moderation actions from the `moderation:actions` Redis stream
using XREAD BLOCK — same pattern as the jams fan-out in the backend.
"""

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Iterator

import redis

from osprey.engine.executor.execution_context import Action
from osprey.worker.sinks.sink.input_stream import BaseInputStream
from osprey.worker.sinks.utils.acking_contexts import (
    BaseAckingContext,
    NoopAckingContext,
)

logger = logging.getLogger(__name__)

# counter for action IDs — Osprey expects unique int IDs
_action_counter = 0


def _next_action_id() -> int:
    global _action_counter
    _action_counter += 1
    return _action_counter


class RedisStreamInput(BaseInputStream[BaseAckingContext[Action]]):
    """reads events from a Redis stream and yields Osprey Actions.

    the backend publishes JSON events to `moderation:actions` after
    copyright scans complete, images are scanned, etc. this input
    stream consumes them with XREAD BLOCK and converts to Action objects.

    event format on the stream:
        {"payload": "{\"action_type\": \"copyright_scan_completed\", ...}"}
    """

    def __init__(
        self,
        redis_url: str,
        stream_key: str = "moderation:actions",
        consumer_group: str = "osprey",
        consumer_name: str | None = None,
        block_ms: int = 5000,
    ) -> None:
        super().__init__()
        self._redis_url = redis_url
        self._stream_key = stream_key
        self._consumer_group = consumer_group
        self._consumer_name = consumer_name or f"osprey-{os.getpid()}"
        self._block_ms = block_ms
        self._client: redis.Redis | None = None

    @classmethod
    def from_env(cls) -> "RedisStreamInput":
        redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
        stream_key = os.environ.get("OSPREY_STREAM_KEY", "moderation:actions")
        consumer_group = os.environ.get("OSPREY_CONSUMER_GROUP", "osprey")
        return cls(
            redis_url=redis_url,
            stream_key=stream_key,
            consumer_group=consumer_group,
        )

    def _ensure_client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.Redis.from_url(
                self._redis_url,
                decode_responses=True,
                socket_connect_timeout=5.0,
            )
            # ensure consumer group exists (MKSTREAM creates the stream if needed)
            try:
                self._client.xgroup_create(
                    self._stream_key,
                    self._consumer_group,
                    id="0",
                    mkstream=True,
                )
                logger.info(
                    "created consumer group %s on %s",
                    self._consumer_group,
                    self._stream_key,
                )
            except redis.ResponseError as e:
                if "BUSYGROUP" not in str(e):
                    raise
                # group already exists, that's fine
        return self._client

    def _gen(self) -> Iterator[BaseAckingContext[Action]]:
        """yield Actions from the Redis stream, blocking when empty."""
        client = self._ensure_client()

        while True:
            try:
                results = client.xreadgroup(
                    groupname=self._consumer_group,
                    consumername=self._consumer_name,
                    streams={self._stream_key: ">"},
                    block=self._block_ms,
                    count=10,
                )
            except redis.ConnectionError:
                logger.warning("redis connection lost, reconnecting in 1s")
                self._client = None
                time.sleep(1)
                client = self._ensure_client()
                continue

            if not results:
                continue

            for _stream_name, messages in results:
                for msg_id, data in messages:
                    action = self._parse_action(msg_id, data)
                    if action is not None:
                        # ACK after successful parse — Osprey handles execution
                        client.xack(
                            self._stream_key,
                            self._consumer_group,
                            msg_id,
                        )
                        yield NoopAckingContext(action)

    def _parse_action(self, msg_id: str, data: dict[str, str]) -> Action | None:
        """parse a Redis stream message into an Osprey Action."""
        try:
            payload_str = data.get("payload", "{}")
            payload = json.loads(payload_str)

            action_type = payload.get("action_type", "unknown")
            timestamp_str = payload.get("timestamp")
            timestamp = (
                datetime.fromisoformat(timestamp_str)
                if timestamp_str
                else datetime.now(timezone.utc)
            )

            return Action(
                action_id=_next_action_id(),
                action_name=action_type,
                data=payload,
                timestamp=timestamp,
            )
        except Exception:
            logger.exception("failed to parse action from msg %s", msg_id)
            return None
