"""ATProto Jetstream consumer for real-time record ingestion.

connects to Jetstream's WebSocket endpoint and listens for fm.plyr.* record
events. events for known DIDs (artists in our database) are dispatched to
docket tasks for resolution into the database.

the consumer itself is lightweight — just WebSocket receive + dispatch. all
heavy lifting (DB queries, record resolution) happens in docket tasks.
"""

import asyncio
import logging
import random
import time
from datetime import timedelta
from typing import Any

import logfire
import orjson
import websockets
from atproto_core.nsid import NSID
from docket import Perpetual
from sqlalchemy import select
from websockets.asyncio.client import ClientConnection

from backend._internal.background import get_docket
from backend._internal.tasks.ingest import (
    ingest_comment_create,
    ingest_comment_delete,
    ingest_comment_update,
    ingest_handle_update,
    ingest_like_create,
    ingest_like_delete,
    ingest_list_create,
    ingest_list_delete,
    ingest_list_update,
    ingest_profile_update,
    ingest_track_create,
    ingest_track_delete,
    ingest_track_update,
)
from backend.config import settings
from backend.models import Artist
from backend.utilities.database import db_session
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)


class JetstreamConsumer:
    """consumes ATProto Jetstream events for this environment's collections.

    args:
        collections: exact collection NSIDs to subscribe to. defaults to the
            5 collections derived from settings.atproto.app_namespace so each
            environment only receives its own records.
    """

    def __init__(self, collections: list[str] | None = None) -> None:
        self._collections = collections or [
            settings.atproto.track_collection,
            settings.atproto.like_collection,
            settings.atproto.comment_collection,
            settings.atproto.list_collection,
            settings.atproto.profile_collection,
        ]
        self._ws: ClientConnection | None = None
        self._known_dids: set[str] = set()
        self._cursor: int | None = None
        self._last_cursor_flush: float = 0.0
        self._last_did_refresh: float = 0.0
        self._shutdown_event = asyncio.Event()

    async def run(self) -> None:
        """main loop with auto-reconnect and exponential backoff."""
        backoff = settings.jetstream.reconnect_base_seconds

        while not self._shutdown_event.is_set():
            try:
                await self._refresh_known_dids()
                await self._load_cursor()
                await self._connect_and_consume()
            except asyncio.CancelledError:
                logger.info("jetstream consumer cancelled")
                await self._flush_cursor()
                return
            except Exception:
                logger.exception("jetstream consumer error, reconnecting")

            if self._shutdown_event.is_set():
                return

            # exponential backoff with jitter
            jitter = random.uniform(0, backoff * 0.5)
            delay = min(backoff + jitter, settings.jetstream.reconnect_max_seconds)
            logger.info("jetstream reconnecting in %.1fs", delay)
            try:
                await asyncio.wait_for(self._shutdown_event.wait(), timeout=delay)
                return  # shutdown requested during backoff
            except TimeoutError:
                pass
            backoff = min(backoff * 2, settings.jetstream.reconnect_max_seconds)

    async def _connect_and_consume(self) -> None:
        """connect to Jetstream and process events until disconnected."""
        url = self._build_url()
        logger.info("jetstream connecting to %s", url)

        with logfire.span(
            "jetstream consume",
            known_dids=len(self._known_dids),
            cursor=self._cursor,
        ):
            async with websockets.connect(url, max_size=2**20) as ws:
                self._ws = ws
                logfire.info(
                    "jetstream connected",
                    known_dids=len(self._known_dids),
                )

                async for raw in ws:
                    if self._shutdown_event.is_set():
                        return

                    try:
                        event = orjson.loads(raw)
                    except (orjson.JSONDecodeError, TypeError):
                        continue

                    await self._process_event(event)
                    await self._maybe_flush_cursor()
                    await self._maybe_refresh_dids()

    async def _process_event(self, event: dict[str, Any]) -> None:
        """check if event is for a known DID and dispatch to docket task."""
        kind = event.get("kind")

        if kind == "identity":
            did = event.get("did")
            handle = (event.get("identity") or {}).get("handle")
            if did and handle and did in self._known_dids:
                docket = get_docket()
                await docket.add(ingest_handle_update)(did=did, handle=handle)
                logfire.info(
                    "jetstream dispatched handle update",
                    did=did,
                    handle=handle,
                )
            if time_us := event.get("time_us"):
                self._cursor = time_us
            return

        if kind != "commit":
            return

        did = event.get("did")
        if not did or did not in self._known_dids:
            return

        commit = event.get("commit", {})
        collection = commit.get("collection", "")
        operation = commit.get("operation", "")
        rkey = commit.get("rkey", "")
        record = commit.get("record")
        cid = commit.get("cid")

        # update cursor from event time_us
        if time_us := event.get("time_us"):
            self._cursor = time_us

        # build AT URI
        uri = f"at://{did}/{collection}/{rkey}"

        await self._dispatch(
            collection=collection,
            operation=operation,
            did=did,
            rkey=rkey,
            record=record,
            uri=uri,
            cid=cid,
        )

    async def _dispatch(
        self,
        collection: str,
        operation: str,
        did: str,
        rkey: str,
        record: dict[str, Any] | None,
        uri: str,
        cid: str | None,
    ) -> None:
        """dispatch event to the appropriate ingest task via docket."""
        docket = get_docket()

        # extract record type from the collection NSID
        # e.g. "fm.plyr.track" or "fm.plyr.dev.track" → "track"
        try:
            record_type = NSID.from_str(collection).name
        except Exception:
            return

        task_map: dict[tuple[str, str], Any] = {
            ("track", "create"): ingest_track_create,
            ("track", "update"): ingest_track_update,
            ("track", "delete"): ingest_track_delete,
            ("like", "create"): ingest_like_create,
            ("like", "delete"): ingest_like_delete,
            ("comment", "create"): ingest_comment_create,
            ("comment", "update"): ingest_comment_update,
            ("comment", "delete"): ingest_comment_delete,
            ("list", "create"): ingest_list_create,
            ("list", "update"): ingest_list_update,
            ("list", "delete"): ingest_list_delete,
        }

        # profile updates are a special case (nested collection)
        if collection.endswith(".actor.profile") and operation == "update":
            await docket.add(ingest_profile_update)(did=did, record=record or {})
            logfire.debug(
                "jetstream dispatched profile.update",
                did=did,
            )
            return

        if task := task_map.get((record_type, operation)):
            kwargs: dict[str, Any] = {"did": did, "rkey": rkey, "uri": uri}
            if operation in ("create", "update"):
                kwargs["record"] = record or {}
                kwargs["cid"] = cid
            await docket.add(task)(**kwargs)
            logfire.info(
                "jetstream dispatched {record_type}.{operation}",
                record_type=record_type,
                operation=operation,
                did=did,
                uri=uri,
            )

    def _build_url(self) -> str:
        """build WebSocket URL with query parameters."""
        params = [f"wantedCollections={c}" for c in self._collections]
        if self._cursor is not None:
            # rewind cursor by 5 seconds for idempotent reprocessing
            rewound = self._cursor - 5_000_000
            params.append(f"cursor={rewound}")
        return f"{settings.jetstream.url}?{'&'.join(params)}"

    async def _load_cursor(self) -> None:
        """load cursor from Redis on startup."""
        try:
            redis = get_async_redis_client()
            if raw := await redis.get(settings.jetstream.cursor_key):
                self._cursor = int(raw)
                logger.info("jetstream resuming from cursor %d", self._cursor)
        except Exception:
            logger.debug("jetstream could not load cursor from redis")

    async def _flush_cursor(self) -> None:
        """persist current cursor to Redis."""
        if self._cursor is None:
            return
        try:
            redis = get_async_redis_client()
            await redis.set(settings.jetstream.cursor_key, str(self._cursor))
        except Exception:
            logger.debug("jetstream could not flush cursor to redis")
        self._last_cursor_flush = time.monotonic()

    async def _maybe_flush_cursor(self) -> None:
        """flush cursor if enough time has elapsed."""
        now = time.monotonic()
        if (
            now - self._last_cursor_flush
            >= settings.jetstream.cursor_flush_interval_seconds
        ):
            await self._flush_cursor()

    async def _refresh_known_dids(self) -> None:
        """refresh the known DID set from the database."""
        try:
            async with db_session() as db:
                result = await db.execute(select(Artist.did))
                self._known_dids = {row[0] for row in result.fetchall()}
            logger.info(
                "jetstream refreshed known DIDs: %d artists", len(self._known_dids)
            )
        except Exception:
            logger.warning("jetstream could not refresh known DIDs", exc_info=True)
        self._last_did_refresh = time.monotonic()

    async def _maybe_refresh_dids(self) -> None:
        """refresh known DIDs if enough time has elapsed."""
        now = time.monotonic()
        if (
            now - self._last_did_refresh
            >= settings.jetstream.did_refresh_interval_seconds
        ):
            await self._refresh_known_dids()


async def consume_jetstream(
    perpetual: Perpetual = Perpetual(every=timedelta(seconds=0), automatic=True),  # noqa: B008
) -> None:
    """perpetual task: run the Jetstream WebSocket consumer.

    docket's Redis lock ensures only one instance runs this across all workers.
    if the consumer exits (crash, disconnect), Perpetual reschedules immediately.
    """
    if not settings.jetstream.enabled:
        perpetual.cancel()
        return

    consumer = JetstreamConsumer()
    await consumer.run()
