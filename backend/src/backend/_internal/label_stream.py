"""Subscriber for the labeler's `com.atproto.label.subscribeLabels` stream.

The backend caches a track's active label values in redis for
`moderation.label_cache_ttl_seconds`. That cache is keyed by subject URI and is
viewer-independent, so a single playback populates it for everyone. Caching the
*absence* of a label is what makes this dangerous: when an operator emits a
label through the labeler UI, a script, or curl, the backend keeps answering
"no labels" until the entry expires, and the audio byte endpoint -- which is
supposed to fail closed -- serves adult audio to anonymous listeners for up to
the full TTL.

`ModerationClient.emit_label` already invalidates on the way out, but it only
covers labels the backend itself emitted, which is the path operators do not
use. This consumer closes the gap at the source: every label the labeler
commits is broadcast on its subscription stream, so the backend invalidates the
subject's cache entries within milliseconds no matter who wrote the label.

Reading the stream instead of having the labeler call back into the backend
keeps the dependency pointing one way (backend -> moderation), which matters
because a single labeler serves both the staging and production backends.
"""

import asyncio
import contextlib
import logging
import random
import time
from typing import Any

import logfire
import orjson
import websockets
from websockets.asyncio.client import ClientConnection

from backend._internal.clients.moderation import get_moderation_client
from backend.config import settings
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)


class LabelStreamConsumer:
    """Invalidates the backend's label cache as the labeler commits labels."""

    def __init__(self) -> None:
        self._ws: ClientConnection | None = None
        self._cursor: int | None = None
        self._last_cursor_flush: float = 0.0
        self._shutdown_event = asyncio.Event()

    def stop(self) -> None:
        """Signal shutdown and unblock the recv loop by closing the socket."""
        self._shutdown_event.set()
        ws = self._ws
        if ws is not None:
            with contextlib.suppress(Exception):
                asyncio.get_running_loop().create_task(ws.close())

    async def run(self) -> None:
        """Main loop with auto-reconnect and exponential backoff."""
        backoff = settings.moderation.label_stream_reconnect_base_seconds

        while not self._shutdown_event.is_set():
            try:
                await self._load_cursor()
                await self._connect_and_consume()
            except asyncio.CancelledError:
                logger.info("label stream consumer cancelled")
                await self._flush_cursor()
                return
            except Exception:
                logger.exception("label stream consumer error, reconnecting")

            if self._shutdown_event.is_set():
                return

            jitter = random.uniform(0, backoff * 0.5)
            delay = min(
                backoff + jitter, settings.moderation.label_stream_reconnect_max_seconds
            )
            logger.info("label stream reconnecting in %.1fs", delay)
            try:
                await asyncio.wait_for(self._shutdown_event.wait(), timeout=delay)
                return
            except TimeoutError:
                pass
            backoff = min(
                backoff * 2, settings.moderation.label_stream_reconnect_max_seconds
            )

    async def _connect_and_consume(self) -> None:
        url = self._build_url()
        logger.info("label stream connecting to %s", url)

        with logfire.span("label stream consume", cursor=self._cursor):
            async with websockets.connect(url, max_size=2**20) as ws:
                self._ws = ws
                logfire.info("label stream connected", cursor=self._cursor)

                async for raw in ws:
                    if self._shutdown_event.is_set():
                        return
                    try:
                        message = orjson.loads(raw)
                    except (orjson.JSONDecodeError, TypeError):
                        continue
                    await self._process_message(message)
                    await self._maybe_flush_cursor()

    async def _process_message(self, message: dict[str, Any]) -> None:
        """Invalidate every subject named by a committed label event.

        Negations invalidate exactly like positives: a stale cached *presence*
        keeps a track hidden after a moderator cleared it, which is the
        fail-closed direction but still wrong.
        """
        labels = message.get("labels") or []
        client = get_moderation_client()

        for label in labels:
            if uri := label.get("uri"):
                await client.invalidate_cache(uri)
                logfire.info(
                    "label cache invalidated from stream",
                    uri=uri,
                    val=label.get("val"),
                    neg=bool(label.get("neg")),
                )

        if (seq := message.get("seq")) is not None:
            self._cursor = int(seq)

    def _build_url(self) -> str:
        base = settings.moderation.label_stream_url or _ws_url(
            settings.moderation.labeler_url
        )
        url = f"{base}/xrpc/com.atproto.label.subscribeLabels"
        if self._cursor is not None:
            # rewind one sequence so a label committed as the socket dropped is
            # replayed; invalidation is idempotent, so re-processing is free.
            url = f"{url}?cursor={max(self._cursor - 1, 0)}"
        return url

    async def _load_cursor(self) -> None:
        try:
            redis = get_async_redis_client()
            if raw := await redis.get(settings.moderation.label_stream_cursor_key):
                self._cursor = int(raw)
                logger.info("label stream resuming from cursor %d", self._cursor)
        except Exception as e:
            logger.warning("could not load label stream cursor: %s", e)

    async def _maybe_flush_cursor(self) -> None:
        interval = settings.moderation.label_stream_cursor_flush_seconds
        if time.monotonic() - self._last_cursor_flush >= interval:
            await self._flush_cursor()

    async def _flush_cursor(self) -> None:
        if self._cursor is None:
            return
        try:
            redis = get_async_redis_client()
            await redis.set(
                settings.moderation.label_stream_cursor_key, str(self._cursor)
            )
            self._last_cursor_flush = time.monotonic()
        except Exception as e:
            logger.warning("could not flush label stream cursor: %s", e)


def _ws_url(http_url: str) -> str:
    """Map the labeler's HTTP origin onto its websocket scheme."""
    if http_url.startswith("https://"):
        return "wss://" + http_url[len("https://") :]
    if http_url.startswith("http://"):
        return "ws://" + http_url[len("http://") :]
    return http_url
