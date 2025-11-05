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

from relay.config import settings
from relay.models import QueueState, Track, UserPreferences
from relay.utilities.database import db_session

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
        self.reconnect_delay = 5  # seconds

    async def setup(self) -> None:
        """initialize the queue service and start LISTEN task."""
        logger.info("starting queue service")
        try:
            await self._connect()
            # start background listener
            self.listener_task = asyncio.create_task(self._listen_loop())
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
            await self.conn.execute(f"NOTIFY queue_changes, '{payload}'")
        except Exception:
            logger.exception(f"error sending queue change notification for {did}")

    async def shutdown(self) -> None:
        """cleanup resources."""
        logger.info("shutting down queue service")

        # cancel listener task
        if self.listener_task:
            self.listener_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.listener_task

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
            .options(selectinload(Track.artist))
            .where(Track.file_id.in_(track_ids))
        )
        result = await db.execute(stmt)
        tracks = result.scalars().all()
        track_by_file_id = {track.file_id: track for track in tracks}

        serialized: list[dict[str, Any]] = []
        for file_id in track_ids:
            track = track_by_file_id.get(file_id)
            if not track:
                continue

            serialized.append(
                {
                    "id": track.id,
                    "title": track.title,
                    "artist": track.artist.display_name
                    if track.artist
                    else track.artist_did,
                    "artist_handle": track.artist.handle
                    if track.artist
                    else track.artist_did,
                    "artist_avatar_url": track.artist.avatar_url
                    if track.artist
                    else None,
                    "album": track.album,
                    "file_id": track.file_id,
                    "file_type": track.file_type,
                    "features": track.features,
                    "r2_url": track.r2_url,
                    "atproto_record_uri": track.atproto_record_uri,
                    "play_count": track.play_count,
                    "created_at": track.created_at.isoformat(),
                }
            )

        return serialized


# global instance
queue_service = QueueService()
