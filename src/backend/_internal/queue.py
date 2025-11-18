"""queue service with LISTEN/NOTIFY for cross-instance sync."""

import asyncio
import contextlib
import json
import logging
from datetime import UTC, datetime
from typing import Any

import asyncpg
from cachetools import TTLCache
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from backend.config import settings
from backend.models import QueueState, Track, UserPreferences
from backend.schemas import TrackResponse
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


class QueueService:
    """service for managing queue state with cross-instance sync via LISTEN/NOTIFY."""

    def __init__(self):
        # TTLCache provides both LRU eviction and TTL expiration
        self.cache: TTLCache[str, tuple[dict[str, Any], int, list[dict[str, Any]]]] = (
            TTLCache(maxsize=100, ttl=300)
        )
        self.conn: asyncpg.Connection | None = None
        self.listener_task: asyncio.Task | None = None
        self.heartbeat_task: asyncio.Task | None = None
        self.reconnect_delay = 5  # seconds
        self.heartbeat_interval = 5  # seconds

    async def setup(self) -> None:
        """initialize the queue service and start LISTEN task."""
        logger.info("starting queue service")
        try:
            await self._connect()
            # start background listener and heartbeat
            self.listener_task = asyncio.create_task(self._listen_loop())
            self.heartbeat_task = asyncio.create_task(self._heartbeat_loop())
        except Exception:
            logger.exception("failed to setup queue service")

    async def _connect(self) -> None:
        """establish asyncpg connection for LISTEN/NOTIFY."""
        # parse connection string - asyncpg needs specific format
        db_url = settings.database.url
        # convert sqlalchemy URL to asyncpg format if needed
        if db_url.startswith("postgresql+asyncpg://"):
            db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
        elif db_url.startswith("postgresql+psycopg://"):
            db_url = db_url.replace("postgresql+psycopg://", "postgresql://")

        try:
            self.conn = await asyncpg.connect(db_url)
            await self.conn.add_listener("queue_changes", self._handle_notification)
            logger.info("queue service connected to database and listening")
        except Exception:
            logger.exception("failed to connect to database for queue listening")
            raise

    async def _listen_loop(self) -> None:
        """background task to maintain LISTEN connection with reconnection logic."""
        while True:
            try:
                # if connection is None or closed, reconnect
                if self.conn is None or self.conn.is_closed():
                    logger.warning("queue listener connection lost, reconnecting...")
                    await asyncio.sleep(self.reconnect_delay)
                    await self._connect()

                # keep connection alive
                await asyncio.sleep(30)

            except asyncio.CancelledError:
                logger.info("queue listener task cancelled")
                break
            except Exception:
                logger.exception("error in queue listener loop")
                await asyncio.sleep(self.reconnect_delay)

    async def _heartbeat_loop(self) -> None:
        """proactively test connection health to detect zombie connections."""
        while True:
            try:
                if self.conn and not self.conn.is_closed():
                    # ping the connection with a short timeout
                    await asyncio.wait_for(self.conn.execute("SELECT 1"), timeout=5.0)
                await asyncio.sleep(self.heartbeat_interval)
            except TimeoutError:
                logger.warning("heartbeat timeout, marking connection as dead")
                if self.conn:
                    with contextlib.suppress(Exception):
                        await self.conn.close()
                    self.conn = None
            except asyncio.CancelledError:
                logger.info("heartbeat task cancelled")
                break
            except Exception:
                logger.exception("error in heartbeat loop")
                # connection likely dead, close it
                if self.conn:
                    with contextlib.suppress(Exception):
                        await self.conn.close()
                    self.conn = None
                await asyncio.sleep(self.reconnect_delay)

    async def _handle_notification(
        self, conn: asyncpg.Connection, pid: int, channel: str, payload: str
    ) -> None:
        """handle queue change notifications."""
        try:
            data = json.loads(payload)
            did = data.get("did")
            if did:
                logger.debug(f"received queue change notification for user {did}")
                # invalidate cache for this user
                self.cache.pop(did, None)
        except Exception:
            logger.exception(f"error handling queue notification: {payload}")

    async def get_queue(
        self, did: str
    ) -> tuple[dict[str, Any], int, list[dict[str, Any]]] | None:
        """get queue state for user, returns (state, revision, tracks) or None."""
        # check cache first
        cached = self.cache.get(did)
        if cached:
            logger.debug(f"cache hit for queue {did}")
            return cached

        # fetch from database
        async with db_session() as db:
            stmt = select(QueueState).where(QueueState.did == did)
            result = await db.execute(stmt)
            queue_state = result.scalar_one_or_none()

            if queue_state:
                # fetch auto_advance from user_preferences
                prefs_stmt = select(UserPreferences).where(UserPreferences.did == did)
                prefs_result = await db.execute(prefs_stmt)
                prefs = prefs_result.scalar_one_or_none()
                auto_advance = prefs.auto_advance if prefs else True

                tracks = await self._hydrate_tracks(
                    db,
                    queue_state.state.get("track_ids", []),
                )
                # include auto_advance in state
                state = {**queue_state.state, "auto_advance": auto_advance}
                data = (state, queue_state.revision, tracks)
                self.cache[did] = data
                return data

            return None

    async def update_queue(
        self,
        did: str,
        state: dict[str, Any],
        expected_revision: int | None = None,
    ) -> tuple[dict[str, Any], int, list[dict[str, Any]]] | None:
        """update queue state with optimistic locking.

        args:
            did: user DID
            state: new queue state
            expected_revision: expected current revision (for conflict detection)

        returns:
            (new_state, new_revision) on success, None on conflict
        """
        async with db_session() as db:
            # fetch current state
            stmt = select(QueueState).where(QueueState.did == did)
            result = await db.execute(stmt)
            existing = result.scalar_one_or_none()

            if existing:
                # check for conflicts
                if (
                    expected_revision is not None
                    and existing.revision != expected_revision
                ):
                    logger.warning(
                        f"queue update conflict for {did}: "
                        f"expected {expected_revision}, got {existing.revision}"
                    )
                    return None

                # update existing
                existing.state = state
                existing.revision += 1
                existing.updated_at = datetime.now(UTC)

            else:
                # create new
                existing = QueueState(
                    did=did,
                    state=state,
                    revision=1,
                    updated_at=datetime.now(UTC),
                )
                db.add(existing)

            try:
                await db.commit()
                await db.refresh(existing)

                # fetch auto_advance from user_preferences
                prefs_stmt = select(UserPreferences).where(UserPreferences.did == did)
                prefs_result = await db.execute(prefs_stmt)
                prefs = prefs_result.scalar_one_or_none()
                auto_advance = prefs.auto_advance if prefs else True

                tracks = await self._hydrate_tracks(
                    db,
                    existing.state.get("track_ids", []),
                )

                # notify other instances
                await self._notify_change(did)

                # update cache - include auto_advance in state
                state_with_prefs = {**existing.state, "auto_advance": auto_advance}
                result_data = (state_with_prefs, existing.revision, tracks)
                self.cache[did] = result_data

                return result_data

            except IntegrityError:
                await db.rollback()
                logger.exception(f"integrity error updating queue for {did}")
                return None

    async def _notify_change(self, did: str) -> None:
        """send NOTIFY to inform other instances of queue change."""
        if not self.conn or self.conn.is_closed():
            logger.warning("cannot send notification: no connection")
            return

        try:
            payload = json.dumps({"did": did})
            # add timeout to prevent hanging on zombie connections
            await asyncio.wait_for(
                self.conn.execute(f"NOTIFY queue_changes, '{payload}'"),
                timeout=1.0,
            )
        except TimeoutError:
            logger.warning(
                f"queue notification timed out for {did}, marking connection as dead"
            )
            # connection is zombie, close it so listener loop reconnects
            if self.conn:
                with contextlib.suppress(Exception):
                    await self.conn.close()
                self.conn = None
        except Exception:
            logger.exception(f"error sending queue change notification for {did}")

    async def shutdown(self) -> None:
        """cleanup resources."""
        logger.info("shutting down queue service")

        # cancel background tasks
        if self.listener_task:
            self.listener_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.listener_task

        if self.heartbeat_task:
            self.heartbeat_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.heartbeat_task

        # close connection
        if self.conn and not self.conn.is_closed():
            try:
                await self.conn.remove_listener(
                    "queue_changes", self._handle_notification
                )
                await self.conn.close()
            except Exception:
                logger.exception("error closing queue service connection")

        self.cache.clear()

    async def _hydrate_tracks(
        self,
        db,
        track_ids: list[str],
    ) -> list[dict[str, Any]]:
        """fetch track metadata for queue display, preserving order."""
        if not track_ids:
            return []

        stmt = (
            select(Track)
            .options(selectinload(Track.artist), selectinload(Track.album_rel))
            .where(Track.file_id.in_(track_ids))
        )
        result = await db.execute(stmt)
        tracks = result.scalars().all()
        track_by_file_id = {track.file_id: track for track in tracks}

        # collect tracks in order
        tracks_in_order = []
        for file_id in track_ids:
            track = track_by_file_id.get(file_id)
            if track:
                tracks_in_order.append(track)

        # batch backfill image URLs for legacy records
        tracks_needing_backfill = [
            track for track in tracks_in_order if not track.image_url and track.image_id
        ]

        if tracks_needing_backfill:
            # fetch URLs concurrently
            image_urls = await asyncio.gather(
                *[track.get_image_url() for track in tracks_needing_backfill]
            )
            # update tracks with fetched URLs
            for track, url in zip(tracks_needing_backfill, image_urls, strict=False):
                if url:
                    track.image_url = url
                    db.add(track)

        # serialize tracks using shared schema
        # note: queue responses don't include like status or atproto URLs
        # to avoid additional db queries - clients can fetch these separately if needed
        serialized: list[dict[str, Any]] = []
        for track in tracks_in_order:
            track_response = await TrackResponse.from_track(
                track,
                pds_url=None,
                liked_track_ids=None,
                like_counts=None,
            )
            serialized.append(track_response.model_dump(mode="json"))

        # commit any lazy backfills
        if tracks_needing_backfill:
            await db.commit()

        return serialized


# global instance
queue_service = QueueService()
