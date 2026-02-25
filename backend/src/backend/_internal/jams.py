"""jam service for shared listening rooms.

manages jam lifecycle, WebSocket connections, and Redis Streams
for real-time playback sync across participants.
"""

import asyncio
import contextlib
import copy
import json
import logging
import secrets
import string
import time
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from backend.models import Track
from backend.models.jam import Jam, JamParticipant
from backend.schemas import TrackResponse
from backend.utilities.database import db_session
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

CODE_ALPHABET = string.ascii_lowercase + string.digits
CODE_LENGTH = 8
MAX_CODE_ATTEMPTS = 10


def _generate_code() -> str:
    """generate an 8-char alphanumeric code for jam URLs."""
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def _empty_state() -> dict[str, Any]:
    """return an empty jam playback state."""
    return {
        "track_ids": [],
        "current_index": 0,
        "current_track_id": None,
        "is_playing": False,
        "progress_ms": 0,
        "server_time_ms": int(time.time() * 1000),
        "output_client_id": None,
        "output_did": None,
    }


class JamService:
    """service for managing jams with Redis Streams + WebSocket fan-out."""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}
        self._ws_by_did: dict[str, tuple[str, WebSocket]] = {}  # did → (jam_id, ws)
        self._ws_client_ids: dict[WebSocket, str] = {}  # ws → client_id
        self._reader_tasks: dict[str, asyncio.Task] = {}

    async def setup(self) -> None:
        """initialize the jam service."""
        logger.info("starting jam service")

    async def shutdown(self) -> None:
        """cleanup resources."""
        logger.info("shutting down jam service")
        # cancel all reader tasks
        for _jam_id, task in self._reader_tasks.items():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._reader_tasks.clear()
        self._connections.clear()
        self._ws_client_ids.clear()

    # ── jam lifecycle ──────────────────────────────────────────────

    async def create_jam(
        self,
        host_did: str,
        name: str | None = None,
        track_ids: list[str] | None = None,
        current_index: int = 0,
        is_playing: bool = False,
        progress_ms: int = 0,
    ) -> dict[str, Any]:
        """create a new jam. auto-leaves any existing jam the host is in."""
        await self._auto_leave(host_did)

        state = _empty_state()
        if track_ids:
            state["track_ids"] = track_ids
            idx = min(current_index, len(track_ids) - 1) if track_ids else 0
            state["current_index"] = idx
            state["current_track_id"] = track_ids[idx] if track_ids else None
            state["is_playing"] = is_playing
            state["progress_ms"] = progress_ms
            state["server_time_ms"] = int(time.time() * 1000)

        async with db_session() as db:
            # generate unique code
            code = await self._generate_unique_code(db)

            jam = Jam(
                id=secrets.token_hex(16),
                code=code,
                host_did=host_did,
                name=name,
                state=state,
                revision=1,
                is_active=True,
            )
            db.add(jam)

            # host joins automatically
            participant = JamParticipant(
                jam_id=jam.id,
                did=host_did,
            )
            db.add(participant)
            await db.commit()
            await db.refresh(jam)

            tracks = await self._hydrate_tracks(db, state.get("track_ids", []))

            return self._serialize_jam(jam, tracks=tracks)

    async def get_jam_by_code(self, code: str) -> dict[str, Any] | None:
        """get jam details by code."""
        async with db_session() as db:
            jam = await self._fetch_jam_by_code(db, code)
            if not jam:
                return None
            tracks = await self._hydrate_tracks(db, jam.state.get("track_ids", []))
            participants = await self._get_participants(db, jam.id)
            return self._serialize_jam(jam, tracks=tracks, participants=participants)

    async def join_jam(self, code: str, did: str) -> dict[str, Any] | None:
        """join a jam by code. auto-leaves any existing jam."""
        await self._auto_leave(did)

        async with db_session() as db:
            jam = await self._fetch_jam_by_code(db, code)
            if not jam or not jam.is_active:
                return None

            # check if already participating
            existing = await db.execute(
                select(JamParticipant).where(
                    JamParticipant.jam_id == jam.id,
                    JamParticipant.did == did,
                    JamParticipant.left_at.is_(None),
                )
            )
            if not existing.scalar_one_or_none():
                participant = JamParticipant(jam_id=jam.id, did=did)
                db.add(participant)
                await db.commit()

            # publish participant event
            await self._publish_event(
                jam.id,
                {
                    "type": "participant",
                    "event": "joined",
                    "did": did,
                    "revision": jam.revision,
                },
            )

            tracks = await self._hydrate_tracks(db, jam.state.get("track_ids", []))
            participants = await self._get_participants(db, jam.id)
            return self._serialize_jam(jam, tracks=tracks, participants=participants)

    async def leave_jam(self, jam_id: str, did: str) -> bool:
        """leave a jam. if last participant, end the jam."""
        # check if leaving user is the output device
        if entry := self._ws_by_did.get(did):
            if entry[0] == jam_id:
                ws = entry[1]
                if client_id := self._ws_client_ids.get(ws):
                    await self._clear_output_if_matches(jam_id, client_id)

        async with db_session() as db:
            # mark participant as left
            cursor = await db.execute(
                update(JamParticipant)
                .where(
                    JamParticipant.jam_id == jam_id,
                    JamParticipant.did == did,
                    JamParticipant.left_at.is_(None),
                )
                .values(left_at=datetime.now(UTC))
            )
            if cursor.rowcount == 0:  # type: ignore[union-attr]
                return False

            # check remaining participants
            remaining = await db.execute(
                select(JamParticipant).where(
                    JamParticipant.jam_id == jam_id,
                    JamParticipant.left_at.is_(None),
                )
            )
            if not remaining.scalars().first():
                # last participant left — end the jam
                await self._end_jam(db, jam_id)

            await db.commit()

            # publish participant event
            jam = await self._fetch_jam_by_id(db, jam_id)
            if jam:
                await self._publish_event(
                    jam_id,
                    {
                        "type": "participant",
                        "event": "left",
                        "did": did,
                        "revision": jam.revision,
                    },
                )

            return True

    async def end_jam(self, jam_id: str, did: str) -> bool:
        """end a jam (host only)."""
        async with db_session() as db:
            jam = await self._fetch_jam_by_id(db, jam_id)
            if not jam or not jam.is_active:
                return False
            if jam.host_did != did:
                return False
            await self._end_jam(db, jam_id)
            await db.commit()
            return True

    async def get_active_jam(self, did: str) -> dict[str, Any] | None:
        """get the user's current active jam."""
        async with db_session() as db:
            result = await db.execute(
                select(JamParticipant)
                .where(
                    JamParticipant.did == did,
                    JamParticipant.left_at.is_(None),
                )
                .order_by(JamParticipant.joined_at.desc())
                .limit(1)
            )
            participant = result.scalar_one_or_none()
            if not participant:
                return None

            jam = await self._fetch_jam_by_id(db, participant.jam_id)
            if not jam or not jam.is_active:
                return None

            tracks = await self._hydrate_tracks(db, jam.state.get("track_ids", []))
            participants = await self._get_participants(db, jam.id)
            return self._serialize_jam(jam, tracks=tracks, participants=participants)

    # ── playback commands ──────────────────────────────────────────

    async def handle_command(
        self, jam_id: str, did: str, command: dict[str, Any]
    ) -> dict[str, Any] | None:
        """process a playback command: mutate state, publish event."""
        async with db_session() as db:
            # FOR UPDATE serializes concurrent commands on the same jam
            result = await db.execute(
                select(Jam).where(Jam.id == jam_id).with_for_update()
            )
            jam = result.scalar_one_or_none()
            if not jam or not jam.is_active:
                return None

            # verify participant
            participant = await db.execute(
                select(JamParticipant).where(
                    JamParticipant.jam_id == jam_id,
                    JamParticipant.did == did,
                    JamParticipant.left_at.is_(None),
                )
            )
            if not participant.scalar_one_or_none():
                return None

            state = copy.deepcopy(jam.state)
            old_track_ids = state.get("track_ids", [])
            cmd_type = command.get("type")
            now_ms = int(time.time() * 1000)

            if cmd_type == "play":
                state["is_playing"] = True
                state["server_time_ms"] = now_ms
            elif cmd_type == "pause":
                # freeze progress at current interpolated position
                if state.get("is_playing"):
                    elapsed = now_ms - state.get("server_time_ms", now_ms)
                    state["progress_ms"] = state.get("progress_ms", 0) + elapsed
                state["is_playing"] = False
                state["server_time_ms"] = now_ms
            elif cmd_type == "seek":
                state["progress_ms"] = command.get("position_ms", 0)
                state["server_time_ms"] = now_ms
            elif cmd_type == "update_queue":
                old_track_id = state.get("current_track_id")
                new_track_ids = command.get("track_ids", old_track_ids)
                new_index = command.get("current_index", state.get("current_index", 0))

                state["track_ids"] = new_track_ids
                if new_track_ids:
                    state["current_index"] = max(
                        0, min(new_index, len(new_track_ids) - 1)
                    )
                    state["current_track_id"] = new_track_ids[state["current_index"]]
                else:
                    state["current_index"] = 0
                    state["current_track_id"] = None

                # reset progress when current track changes
                if state["current_track_id"] != old_track_id:
                    state["progress_ms"] = 0
                    state["server_time_ms"] = now_ms
            elif cmd_type == "set_output":
                # validate: the client_id must belong to the sender's WS in THIS jam
                requested_client_id = command.get("client_id")
                entry = self._ws_by_did.get(did)
                if entry and requested_client_id and entry[0] == jam_id:
                    sender_ws = entry[1]
                    actual_client_id = self._ws_client_ids.get(sender_ws)
                    if actual_client_id == requested_client_id:
                        state["output_client_id"] = requested_client_id
                        state["output_did"] = did
                    else:
                        logger.warning(
                            "set_output rejected: client_id mismatch for %s", did
                        )
                        return None
                else:
                    return None
            else:
                logger.warning("unknown jam command type: %s", cmd_type)
                return None

            # commit state
            jam.state = state
            jam.revision += 1
            jam.updated_at = datetime.now(UTC)
            await db.commit()
            await db.refresh(jam)

            # determine if tracks changed
            tracks_changed = state.get("track_ids", []) != old_track_ids

            tracks: list[dict[str, Any]] = []
            if tracks_changed:
                tracks = await self._hydrate_tracks(db, state.get("track_ids", []))

            # publish to Redis stream
            event: dict[str, Any] = {
                "type": "state",
                "revision": jam.revision,
                "state": state,
                "tracks_changed": tracks_changed,
                "actor": {"did": did, "type": cmd_type},
            }
            if tracks_changed:
                event["tracks"] = tracks
            await self._publish_event(jam_id, event)

            return {
                "state": state,
                "revision": jam.revision,
                "tracks": tracks,
                "tracks_changed": tracks_changed,
            }

    # ── WebSocket management ───────────────────────────────────────

    async def connect_ws(self, jam_id: str, ws: WebSocket, did: str) -> None:
        """register a WebSocket connection for a jam."""
        # close any previous socket for this user (e.g. stale from auto-leave)
        await self._close_ws_for_did(did)

        if jam_id not in self._connections:
            self._connections[jam_id] = set()
        self._connections[jam_id].add(ws)
        self._ws_by_did[did] = (jam_id, ws)

        # start reader task if first connection for this jam
        if jam_id not in self._reader_tasks or self._reader_tasks[jam_id].done():
            self._reader_tasks[jam_id] = asyncio.create_task(
                self._stream_reader(jam_id)
            )
            logger.info("started stream reader for jam %s", jam_id)

    async def disconnect_ws(self, jam_id: str, ws: WebSocket) -> None:
        """unregister a WebSocket connection."""
        # check if disconnecting WS was the output device
        disconnecting_client_id = self._ws_client_ids.pop(ws, None)
        if disconnecting_client_id:
            await self._clear_output_if_matches(jam_id, disconnecting_client_id)

        # clean up did tracking
        dids_to_remove = [
            did
            for did, (jid, w) in self._ws_by_did.items()
            if jid == jam_id and w is ws
        ]
        for did in dids_to_remove:
            del self._ws_by_did[did]

        if jam_id in self._connections:
            self._connections[jam_id].discard(ws)
            if not self._connections[jam_id]:
                del self._connections[jam_id]
                # cancel reader if no more connections
                if jam_id in self._reader_tasks:
                    self._reader_tasks[jam_id].cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await self._reader_tasks[jam_id]
                    del self._reader_tasks[jam_id]
                    logger.info("stopped stream reader for jam %s", jam_id)

    async def _close_ws_for_did(self, did: str) -> None:
        """close any existing WebSocket for this DID."""
        entry = self._ws_by_did.pop(did, None)
        if not entry:
            return
        old_jam_id, old_ws = entry
        # clear output BEFORE removing client_id — disconnect_ws won't be able
        # to find the mapping after we pop it
        if client_id := self._ws_client_ids.pop(old_ws, None):
            await self._clear_output_if_matches(old_jam_id, client_id)
        if old_jam_id in self._connections:
            self._connections[old_jam_id].discard(old_ws)
        with contextlib.suppress(Exception):
            await old_ws.close(code=4010, reason="replaced by new connection")

    async def _clear_output_if_matches(self, jam_id: str, client_id: str) -> None:
        """clear output_client_id and pause if it matches the given client_id."""
        async with db_session() as db:
            jam = await self._fetch_jam_by_id(db, jam_id)
            if not jam or not jam.is_active:
                return
            if jam.state.get("output_client_id") != client_id:
                return
            state = copy.deepcopy(jam.state)
            state["output_client_id"] = None
            state["output_did"] = None
            state["is_playing"] = False
            jam.state = state
            jam.revision += 1
            jam.updated_at = datetime.now(UTC)
            await db.commit()
            await db.refresh(jam)
            await self._publish_event(
                jam_id,
                {
                    "type": "state",
                    "revision": jam.revision,
                    "state": state,
                    "tracks_changed": False,
                    "actor": {"did": "system", "type": "output_disconnected"},
                },
            )

    async def handle_ws_message(
        self, jam_id: str, did: str, message: dict[str, Any], ws: WebSocket
    ) -> None:
        """process an incoming WebSocket message."""
        msg_type = message.get("type")

        if msg_type == "ping":
            await ws.send_json({"type": "pong"})
        elif msg_type == "sync":
            await self._handle_sync(jam_id, did, message, ws)
        elif msg_type == "command":
            payload = message.get("payload", {})
            result = await self.handle_command(jam_id, did, payload)
            if not result:
                await ws.send_json({"type": "error", "message": "command failed"})
        else:
            await ws.send_json(
                {"type": "error", "message": f"unknown message type: {msg_type}"}
            )

    async def _handle_sync(
        self, jam_id: str, did: str, message: dict[str, Any], ws: WebSocket
    ) -> None:
        """handle sync/reconnect request from a client."""
        # store client_id from sync message
        if client_id := message.get("client_id"):
            self._ws_client_ids[ws] = client_id

            # auto-set output to host on first connect if no output set
            async with db_session() as db:
                jam = await self._fetch_jam_by_id(db, jam_id)
                if (
                    jam
                    and jam.is_active
                    and jam.state.get("output_client_id") is None
                    and did == jam.host_did
                ):
                    state = copy.deepcopy(jam.state)
                    state["output_client_id"] = client_id
                    state["output_did"] = did
                    jam.state = state
                    jam.revision += 1
                    jam.updated_at = datetime.now(UTC)
                    await db.commit()
                    await db.refresh(jam)
                    await self._publish_event(
                        jam_id,
                        {
                            "type": "state",
                            "revision": jam.revision,
                            "state": state,
                            "tracks_changed": False,
                            "actor": {"did": "system", "type": "auto_output"},
                        },
                    )

        last_id = message.get("last_id")

        if not last_id:
            # full snapshot from DB
            async with db_session() as db:
                jam = await self._fetch_jam_by_id(db, jam_id)
                if not jam:
                    await ws.send_json({"type": "error", "message": "jam not found"})
                    return
                tracks = await self._hydrate_tracks(db, jam.state.get("track_ids", []))
                participants = await self._get_participants(db, jam.id)

            await ws.send_json(
                {
                    "type": "state",
                    "stream_id": None,
                    "revision": jam.revision,
                    "state": jam.state,
                    "tracks": tracks,
                    "tracks_changed": True,
                    "participants": participants,
                    "actor": {"did": "system", "type": "sync"},
                }
            )
        else:
            # replay from last_id
            try:
                redis = get_async_redis_client()
                stream_key = f"jam:{jam_id}:events"
                messages = await redis.xrange(stream_key, min=f"({last_id}", max="+")

                tracks_changed = False
                for msg_id, data in messages:
                    payload = json.loads(data.get("payload", "{}"))
                    if payload.get("tracks_changed"):
                        tracks_changed = True
                    await ws.send_json(
                        {
                            **payload,
                            "stream_id": msg_id,
                        }
                    )

                # if tracks changed during replay, send full track list
                if tracks_changed:
                    async with db_session() as db:
                        jam = await self._fetch_jam_by_id(db, jam_id)
                        if jam:
                            tracks = await self._hydrate_tracks(
                                db, jam.state.get("track_ids", [])
                            )
                            await ws.send_json(
                                {
                                    "type": "state",
                                    "stream_id": None,
                                    "revision": jam.revision,
                                    "state": jam.state,
                                    "tracks": tracks,
                                    "tracks_changed": True,
                                    "actor": {"did": "system", "type": "sync"},
                                }
                            )
            except Exception:
                logger.exception("sync replay failed for jam %s", jam_id)
                # fall back to full snapshot
                await self._handle_sync(jam_id, did, {"last_id": None}, ws)

    # ── Redis Streams ──────────────────────────────────────────────

    async def _publish_event(self, jam_id: str, event: dict[str, Any]) -> None:
        """publish an event to the jam's Redis stream."""
        try:
            redis = get_async_redis_client()
            stream_key = f"jam:{jam_id}:events"
            await redis.xadd(
                stream_key,
                {"payload": json.dumps(event)},
                maxlen=1000,
                approximate=True,
            )
        except Exception:
            logger.exception("failed to publish event for jam %s", jam_id)

    async def _stream_reader(self, jam_id: str) -> None:
        """background task that reads from a jam's Redis stream and fans out."""
        redis = get_async_redis_client()
        stream_key = f"jam:{jam_id}:events"
        last_id = "$"

        while True:
            try:
                results = await redis.xread({stream_key: last_id}, block=5000, count=10)
                for _, messages in results or []:
                    for msg_id, data in messages:
                        last_id = msg_id
                        payload = json.loads(data.get("payload", "{}"))
                        payload["stream_id"] = msg_id
                        await self._fan_out(jam_id, payload)
            except asyncio.CancelledError:
                logger.info("stream reader cancelled for jam %s", jam_id)
                break
            except Exception:
                logger.exception("error in stream reader for jam %s", jam_id)
                await asyncio.sleep(1)

    async def _fan_out(self, jam_id: str, payload: dict[str, Any]) -> None:
        """send a message to all connected WebSockets for a jam."""
        connections = self._connections.get(jam_id, set())
        dead: list[WebSocket] = []

        for ws in connections:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)

        for ws in dead:
            connections.discard(ws)

    # ── internal helpers ───────────────────────────────────────────

    async def _generate_unique_code(self, db: Any) -> str:
        """generate a unique jam code, retrying on collision."""
        for _ in range(MAX_CODE_ATTEMPTS):
            code = _generate_code()
            result = await db.execute(select(Jam).where(Jam.code == code))
            if not result.scalar_one_or_none():
                return code
        raise RuntimeError("failed to generate unique jam code")

    async def _fetch_jam_by_code(self, db: Any, code: str) -> Jam | None:
        """fetch a jam by its short code."""
        result = await db.execute(select(Jam).where(Jam.code == code))
        return result.scalar_one_or_none()

    async def _fetch_jam_by_id(self, db: Any, jam_id: str) -> Jam | None:
        """fetch a jam by ID."""
        result = await db.execute(select(Jam).where(Jam.id == jam_id))
        return result.scalar_one_or_none()

    async def _end_jam(self, db: Any, jam_id: str) -> None:
        """mark a jam as ended."""
        now = datetime.now(UTC)
        await db.execute(
            update(Jam)
            .where(Jam.id == jam_id)
            .values(is_active=False, ended_at=now, updated_at=now)
        )
        # mark all remaining participants as left
        await db.execute(
            update(JamParticipant)
            .where(
                JamParticipant.jam_id == jam_id,
                JamParticipant.left_at.is_(None),
            )
            .values(left_at=now)
        )
        # trim Redis stream
        try:
            redis = get_async_redis_client()
            await redis.delete(f"jam:{jam_id}:events")
        except Exception:
            logger.exception("failed to trim stream for jam %s", jam_id)

    async def _auto_leave(self, did: str) -> None:
        """leave any existing active jam for this user."""
        async with db_session() as db:
            result = await db.execute(
                select(JamParticipant).where(
                    JamParticipant.did == did,
                    JamParticipant.left_at.is_(None),
                )
            )
            for participant in result.scalars().all():
                participant.left_at = datetime.now(UTC)
            await db.commit()

    async def _get_participants(self, db: Any, jam_id: str) -> list[dict[str, Any]]:
        """get active participants for a jam with artist info."""
        from backend.models.artist import Artist

        result = await db.execute(
            select(JamParticipant, Artist)
            .join(Artist, JamParticipant.did == Artist.did)
            .where(
                JamParticipant.jam_id == jam_id,
                JamParticipant.left_at.is_(None),
            )
        )
        participants = []
        for participant, artist in result.all():
            participants.append(
                {
                    "did": participant.did,
                    "handle": artist.handle,
                    "display_name": artist.display_name,
                    "avatar_url": artist.avatar_url,
                }
            )
        return participants

    async def _hydrate_tracks(
        self, db: Any, track_ids: list[str]
    ) -> list[dict[str, Any]]:
        """fetch track metadata for jam display, preserving order."""
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

        serialized: list[dict[str, Any]] = []
        for file_id in track_ids:
            if track := track_by_file_id.get(file_id):
                track_response = await TrackResponse.from_track(
                    track, pds_url=None, liked_track_ids=None, like_counts=None
                )
                serialized.append(track_response.model_dump(mode="json"))

        return serialized

    def _serialize_jam(
        self,
        jam: Jam,
        tracks: list[dict[str, Any]] | None = None,
        participants: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """serialize a jam for API responses."""
        return {
            "id": jam.id,
            "code": jam.code,
            "host_did": jam.host_did,
            "name": jam.name,
            "state": jam.state,
            "revision": jam.revision,
            "is_active": jam.is_active,
            "created_at": jam.created_at.isoformat(),
            "updated_at": jam.updated_at.isoformat(),
            "ended_at": jam.ended_at.isoformat() if jam.ended_at else None,
            "tracks": tracks or [],
            "participants": participants or [],
        }


# global instance
jam_service = JamService()
