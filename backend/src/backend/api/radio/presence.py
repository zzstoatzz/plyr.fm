"""Ephemeral, session-authenticated radio listeners shared through Redis."""

import asyncio
import contextlib
import json
import logging
import time
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal.auth.session import get_session
from backend.api.radio.router import router
from backend.api.radio.stations import get_station
from backend.config import settings
from backend.models import Artist, get_db
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)
PRESENCE_TTL = 60
HEARTBEAT_TIMEOUT = 45


class Listener(BaseModel):
    did: str
    handle: str
    display_name: str
    avatar_url: str | None


class Listeners(BaseModel):
    count: int
    listeners: list[Listener]


def presence_key(station: str) -> str:
    return f"radio:listeners:{station}"


async def touch_listener(station: str, member: str) -> None:
    redis = get_async_redis_client()
    async with redis.pipeline(transaction=True) as pipe:
        pipe.zadd(presence_key(station), {member: time.time()})
        pipe.expire(presence_key(station), PRESENCE_TTL)
        await pipe.execute()


async def remove_listener(station: str, member: str) -> None:
    await get_async_redis_client().zrem(presence_key(station), member)


async def listener_ids(station: str) -> tuple[int, list[str]]:
    redis = get_async_redis_client()
    async with redis.pipeline(transaction=True) as pipe:
        pipe.zremrangebyscore(presence_key(station), "-inf", time.time() - PRESENCE_TTL)
        pipe.zrange(presence_key(station), 0, -1)
        _, members = await pipe.execute()
    dids: set[str] = set()
    guests = 0
    for member in members:
        did, _ = json.loads(member)
        if did:
            dids.add(did)
        else:
            guests += 1
    return len(dids) + guests, sorted(dids)


@router.get("/{station}/listeners")
async def get_listeners(station: str, db: AsyncSession = Depends(get_db)) -> Listeners:
    if not get_station(station):
        raise HTTPException(status_code=404, detail="station not found")
    try:
        count, dids = await listener_ids(station)
    except RedisError as exc:
        raise HTTPException(status_code=503, detail="presence unavailable") from exc
    artists = (
        (
            (await db.execute(select(Artist).where(Artist.did.in_(dids[:24]))))
            .scalars()
            .all()
        )
        if dids
        else []
    )
    return Listeners(
        count=count,
        listeners=[
            Listener(
                did=artist.did,
                handle=artist.handle,
                display_name=artist.display_name,
                avatar_url=artist.avatar_url,
            )
            for artist in sorted(artists, key=lambda artist: artist.did)
        ],
    )


def allowed_origin(origin: str | None) -> bool:
    expected = urlsplit(settings.frontend.url)
    if origin == f"{expected.scheme}://{expected.netloc}":
        return True
    if not settings.app.debug or not origin:
        return False
    actual = urlsplit(origin)
    return actual.scheme == "http" and actual.hostname in {"localhost", "127.0.0.1"}


@router.websocket("/{station}/listen")
async def listen(ws: WebSocket, station: str) -> None:
    if not get_station(station) or not allowed_origin(ws.headers.get("origin")):
        await ws.close(code=1008)
        return
    session_id = ws.cookies.get("session_id")
    session = await get_session(session_id) if session_id else None
    if session_id and not session:
        await ws.close(code=4001)
        return
    did = session.did if session else None
    member = json.dumps([did, str(uuid4())])
    await ws.accept()
    last_message = 0.0
    try:
        while True:
            await touch_listener(station, member)
            await ws.send_json({"type": "listening"})
            message = await asyncio.wait_for(ws.receive_text(), HEARTBEAT_TIMEOUT)
            now = time.monotonic()
            if message != "ping" or now - last_message < 1:
                await ws.close(code=1008)
                return
            last_message = now
            if session_id:
                session = await get_session(session_id)
                if not session or session.did != did:
                    await ws.close(code=4001)
                    return
    except (WebSocketDisconnect, TimeoutError):
        pass
    except RedisError:
        logger.warning("radio presence unavailable")
    finally:
        with contextlib.suppress(RedisError):
            await remove_listener(station, member)
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await ws.close()
