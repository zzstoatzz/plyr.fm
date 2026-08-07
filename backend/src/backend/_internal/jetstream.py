"""ATProto Jetstream consumer for real-time record ingestion.

connects to Jetstream's WebSocket endpoint and listens for fm.plyr.* record
events. events for known DIDs (artists in our database) are dispatched to
docket tasks for resolution into the database.

the consumer itself is lightweight — just WebSocket receive + dispatch. all
heavy lifting (DB queries, record resolution) happens in docket tasks.
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
from atproto_core.nsid import NSID
from sqlalchemy import select
from websockets.asyncio.client import ClientConnection

from backend._internal.background import get_docket
from backend._internal.tasks.ingest import (
    ingest_account_reactivated,
    ingest_account_status_change,
    ingest_bsky_profile_update,
    ingest_comment_create,
    ingest_comment_delete,
    ingest_comment_update,
    ingest_identity_update,
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

# not environment-namespaced: every environment mirrors avatars from the one
# real Bluesky profile collection. ~2 commits/second network-wide, and
# `_process_event` drops everything outside `_known_dids`.
BSKY_PROFILE_COLLECTION = "app.bsky.actor.profile"


class JetstreamConsumer:
    """consumes ATProto Jetstream events for this environment's collections.

    args:
        collections: exact collection NSIDs to subscribe to. defaults to the
            5 collections derived from settings.atproto.app_namespace so each
            environment only receives its own records, plus Bluesky's profile
            collection so avatar changes are mirrored as they happen.
    """

    def __init__(self, collections: list[str] | None = None) -> None:
        self._collections = collections or [
            settings.atproto.track_collection,
            settings.atproto.like_collection,
            settings.atproto.comment_collection,
            settings.atproto.list_collection,
            settings.atproto.profile_collection,
            BSKY_PROFILE_COLLECTION,
        ]
        self._ws: ClientConnection | None = None
        self._known_dids: set[str] = set()
        self._deactivated_dids: set[str] = set()
        self._cursor: int | None = None
        self._last_cursor_flush: float = 0.0
        self._last_did_refresh: float = 0.0
        self._shutdown_event = asyncio.Event()
        self._host_index = 0
        # blind-host detection: a host can stay connected and keep delivering
        # some collections while dropping ours entirely. tracked separately so
        # "our collections are silent" can be told apart from "the network is".
        self._last_own_event: float = 0.0
        self._last_any_event: float = 0.0

    def stop(self) -> None:
        """signal the consumer to shut down and unblock the recv loop.

        closing the socket interrupts the `async for raw in ws` loop so a
        quiet stream doesn't hold the process open until the next message.
        """
        self._shutdown_event.set()
        ws = self._ws
        if ws is not None:
            with contextlib.suppress(Exception):
                asyncio.get_running_loop().create_task(ws.close())

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

            # every reconnect moves on. a host that just dropped us has no
            # claim on the next attempt, and rotating costs nothing when it
            # was healthy — the cursor makes reconnects resumable either way.
            self._rotate_host()

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

        # a fresh connection has not yet proven anything about this host
        self._last_own_event = 0.0
        self._last_any_event = 0.0

        with logfire.span(
            "jetstream consume",
            known_dids=len(self._known_dids),
            cursor=self._cursor,
            endpoint=self._current_endpoint(),
        ):
            async with websockets.connect(url, max_size=2**20) as ws:
                self._ws = ws
                logfire.info(
                    "jetstream connected",
                    known_dids=len(self._known_dids),
                    endpoint=self._current_endpoint(),
                )
                self._last_own_event = self._last_any_event = time.monotonic()

                async for raw in ws:
                    if self._shutdown_event.is_set():
                        return

                    try:
                        event = orjson.loads(raw)
                    except (orjson.JSONDecodeError, TypeError):
                        continue

                    self._last_any_event = time.monotonic()
                    if self._is_own_collection_event(event):
                        self._last_own_event = self._last_any_event

                    await self._process_event(event)
                    await self._maybe_flush_cursor()
                    await self._maybe_refresh_dids()

                    if self._is_blind():
                        # info, not warn: this fires on every quiet fm.plyr
                        # window (see _is_blind), so it is a breadcrumb for
                        # rotation history, not a failure signal.
                        logfire.info(
                            "jetstream host is serving other collections but "
                            "none of ours, rotating",
                            endpoint=self._current_endpoint(),
                            silent_seconds=round(
                                time.monotonic() - self._last_own_event
                            ),
                        )
                        return  # the reconnect loop rotates and resumes

    async def _process_event(self, event: dict[str, Any]) -> None:
        """check if event is for a known DID and dispatch to docket task."""
        kind = event.get("kind")

        if kind == "identity":
            # the identity event carries no handle (payload is just
            # {did, seq, time}) — it's only a signal to re-resolve. the task
            # fetches the current verified handle/PDS from slingshot.
            did = event.get("did")
            if did and did in self._known_dids:
                docket = get_docket()
                await docket.add(ingest_identity_update)(did=did)
                logfire.info(
                    "jetstream dispatched identity update",
                    did=did,
                )
            if time_us := event.get("time_us"):
                self._cursor = time_us
            return

        if kind == "account":
            did = event.get("did")
            account = event.get("account") or {}
            active = account.get("active", False)
            status = account.get("status")
            if did and did in self._known_dids:
                docket = get_docket()
                await docket.add(ingest_account_status_change)(
                    did=did, active=active, status=status
                )
                logfire.info(
                    "jetstream dispatched account status change",
                    did=did,
                    active=active,
                    status=status,
                )
            if time_us := event.get("time_us"):
                self._cursor = time_us
            return

        if kind != "commit":
            return

        did = event.get("did")
        if not did or did not in self._known_dids:
            return

        # a commit proves the repo is being served, which is what `active`
        # claims to describe — so it retires a stale `deactivated` flag that
        # would otherwise need an #account event we may have already missed.
        if did in self._deactivated_dids:
            self._deactivated_dids.discard(did)
            await get_docket().add(ingest_account_reactivated)(did=did)
            logfire.info("jetstream dispatched account reactivation", did=did)

        commit = event.get("commit", {})
        collection = commit.get("collection", "")
        operation = commit.get("operation", "")
        rkey = commit.get("rkey", "")
        record = commit.get("record")
        cid = commit.get("cid")
        rev = commit.get("rev")

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
            rev=rev,
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
        rev: str | None = None,
    ) -> None:
        """dispatch event to the appropriate ingest task via docket."""
        docket = get_docket()

        # bluesky's profile collection, checked before the suffix match below —
        # it also ends in `.actor.profile`, but carries a different schema and
        # feeds a different task.
        if collection == BSKY_PROFILE_COLLECTION:
            if operation in ("create", "update"):
                await docket.add(ingest_bsky_profile_update)(
                    did=did, record=record or {}
                )
                logfire.debug(
                    "jetstream dispatched bsky profile.{operation}",
                    operation=operation,
                    did=did,
                )
            return

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
                if record_type == "track":
                    kwargs["rev"] = rev
            await docket.add(task)(**kwargs)
            logfire.info(
                "jetstream dispatched {record_type}.{operation}",
                record_type=record_type,
                operation=operation,
                did=did,
                uri=uri,
            )

    def _is_own_collection_event(self, event: dict[str, Any]) -> bool:
        """did this event come from one of plyr's own lexicons?

        Bluesky's profile collection is excluded deliberately: it is the
        traffic that made a blind host look alive.
        """
        commit = event.get("commit")
        if not isinstance(commit, dict):
            return False
        collection = commit.get("collection", "")
        return collection != BSKY_PROFILE_COLLECTION and collection in (
            self._collections
        )

    def _current_endpoint(self) -> str:
        """the endpoint for this attempt — pinned URL, or the host in rotation."""
        if pinned := settings.jetstream.url:
            return pinned
        hosts = settings.jetstream.hosts
        return f"wss://{hosts[self._host_index % len(hosts)]}/subscribe"

    def _rotate_host(self) -> None:
        """advance to the next host, and rewind the cursor to cover its lag.

        instances are independently positioned in the stream, so the one we
        move to may be slightly behind the one we left. replaying a little is
        safe (ingest is ordered by commit rev) — a gap would not be.
        """
        if settings.jetstream.url:
            return  # pinned by config; nothing to rotate through
        self._host_index += 1
        if self._cursor is not None:
            self._cursor -= 10_000_000

    def _is_blind(self) -> bool:
        """is this host delivering other collections but none of ours?

        the failure this catches never disconnects: jetstream2 kept serving
        `app.bsky.actor.profile` for 10h on 2026-07-30 while dropping every
        `fm.plyr.*` event. requiring recent *other* traffic separates a blind
        host from a fully quiet stream — but NOT from an organically quiet
        fm.plyr window, because the profile mirror flows constantly and keeps
        `_last_any_event` fresh. so on any night with no fm.plyr writes this
        trips on every host, one rotation per timeout, by design: rotating is
        cheap and the false positive costs a reconnect. it does mean a
        rotation is not evidence of a broken host — the trustworthy outage
        signal is the write echo ("pds record write" with no matching
        "jetstream dispatched"), which is quiet-immune.
        """
        timeout = settings.jetstream.blind_host_timeout_seconds
        if timeout <= 0 or not self._last_own_event or not self._last_any_event:
            return False
        now = time.monotonic()
        return (now - self._last_own_event) > timeout and (
            now - self._last_any_event
        ) < (timeout / 2)

    def _build_url(self) -> str:
        """build WebSocket URL with query parameters."""
        params = [f"wantedCollections={c}" for c in self._collections]
        if self._cursor is not None:
            # rewind cursor by 5 seconds for idempotent reprocessing
            rewound = self._cursor - 5_000_000
            params.append(f"cursor={rewound}")
        return f"{self._current_endpoint()}?{'&'.join(params)}"

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
        """refresh the known DID set from the database.

        also tracks which of them are currently flagged deactivated, so a
        commit from one can retire the flag without a per-commit DB read.
        """
        try:
            async with db_session() as db:
                result = await db.execute(select(Artist.did, Artist.deactivated))
                rows = result.fetchall()
                self._known_dids = {row[0] for row in rows}
                self._deactivated_dids = {row[0] for row in rows if row[1]}
            logger.info(
                "jetstream refreshed known DIDs: %d artists (%d deactivated)",
                len(self._known_dids),
                len(self._deactivated_dids),
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
