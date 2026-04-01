"""jam api endpoints for shared listening rooms."""

import asyncio
import contextlib
import json
import logging
from typing import Annotated, Any
from urllib.parse import urlparse

from fastapi import (
    APIRouter,
    Cookie,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
)
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from backend._internal import Session, jam_service, require_auth
from backend._internal.auth.session import get_session
from backend.config import settings
from backend.models.artist import Artist
from backend.models.jam import Jam, JamParticipant
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jams", tags=["jams"])

IDLE_TIMEOUT_SECONDS = 300  # 5 minutes — close idle connections
MAX_CONNECTIONS_PER_JAM = 50

# ── request/response models ───────────────────────────────────────


class CreateJamRequest(BaseModel):
    name: str | None = None
    track_ids: list[str] = Field(default_factory=list)
    current_index: int = 0
    is_playing: bool = False
    progress_ms: int = 0


class CommandRequest(BaseModel):
    type: str
    position_ms: int | None = None
    track_ids: list[str] | None = None
    current_index: int | None = None
    client_id: str | None = None
    mode: str | None = None


class JamResponse(BaseModel):
    id: str
    code: str
    host_did: str
    name: str | None
    state: dict[str, Any]
    revision: int
    is_active: bool
    created_at: str
    updated_at: str
    ended_at: str | None
    tracks: list[dict[str, Any]] = Field(default_factory=list)
    participants: list[dict[str, Any]] = Field(default_factory=list)


class JamPreviewResponse(BaseModel):
    code: str
    name: str | None
    is_active: bool
    host_handle: str
    host_display_name: str
    host_avatar_url: str | None
    participant_count: int


# ── REST endpoints ─────────────────────────────────────────────────


@router.post("/", response_model=JamResponse)
async def create_jam(
    body: CreateJamRequest,
    session: Session = Depends(require_auth),
) -> JamResponse:
    """create a new jam."""
    result = await jam_service.create_jam(
        host_did=session.did,
        name=body.name,
        track_ids=body.track_ids,
        current_index=body.current_index,
        is_playing=body.is_playing,
        progress_ms=body.progress_ms,
    )
    return JamResponse(**result)


@router.get("/active", response_model=JamResponse | None)
async def get_active_jam(
    session: Session = Depends(require_auth),
) -> JamResponse | None:
    """get the user's current active jam."""
    result = await jam_service.get_active_jam(session.did)
    if not result:
        return None
    return JamResponse(**result)


@router.get("/{code}/preview", response_model=JamPreviewResponse)
async def get_jam_preview(code: str) -> JamPreviewResponse:
    """public preview info for a jam (no auth required)."""
    async with db_session() as db:
        result = await db.execute(
            select(Jam, Artist)
            .join(Artist, Jam.host_did == Artist.did)
            .where(Jam.code == code)
        )
        row = result.one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="jam not found")

        jam_row, host = row._tuple()

        participant_count = await db.scalar(
            select(func.count())
            .select_from(JamParticipant)
            .where(
                JamParticipant.jam_id == jam_row.id,
                JamParticipant.left_at.is_(None),
            )
        )

    return JamPreviewResponse(
        code=jam_row.code,
        name=jam_row.name,
        is_active=jam_row.is_active,
        host_handle=host.handle,
        host_display_name=host.display_name,
        host_avatar_url=host.avatar_url,
        participant_count=participant_count or 0,
    )


@router.get("/{code}", response_model=JamResponse)
async def get_jam(
    code: str,
    session: Session = Depends(require_auth),
) -> JamResponse:
    """get jam details by code."""
    result = await jam_service.get_jam_by_code(code)
    if not result:
        raise HTTPException(status_code=404, detail="jam not found")
    return JamResponse(**result)


@router.post("/{code}/join", response_model=JamResponse)
async def join_jam(
    code: str,
    session: Session = Depends(require_auth),
) -> JamResponse:
    """join a jam."""
    result = await jam_service.join_jam(code, session.did)
    if not result:
        raise HTTPException(status_code=404, detail="jam not found or not active")
    return JamResponse(**result)


@router.post("/{code}/leave")
async def leave_jam(
    code: str,
    session: Session = Depends(require_auth),
) -> dict[str, bool]:
    """leave a jam."""
    jam = await jam_service.get_jam_by_code(code)
    if not jam:
        raise HTTPException(status_code=404, detail="jam not found")
    success = await jam_service.leave_jam(jam["id"], session.did)
    if not success:
        raise HTTPException(status_code=400, detail="not in this jam")
    return {"ok": True}


@router.post("/{code}/end")
async def end_jam(
    code: str,
    session: Session = Depends(require_auth),
) -> dict[str, bool]:
    """end a jam (host only)."""
    jam = await jam_service.get_jam_by_code(code)
    if not jam:
        raise HTTPException(status_code=404, detail="jam not found")
    success = await jam_service.end_jam(jam["id"], session.did)
    if not success:
        raise HTTPException(status_code=403, detail="only the host can end the jam")
    return {"ok": True}


@router.post("/{code}/command")
async def jam_command(
    code: str,
    body: CommandRequest,
    session: Session = Depends(require_auth),
) -> dict[str, Any]:
    """send a playback command to the jam."""
    jam = await jam_service.get_jam_by_code(code)
    if not jam:
        raise HTTPException(status_code=404, detail="jam not found")

    command: dict[str, Any] = {"type": body.type}
    if body.position_ms is not None:
        command["position_ms"] = body.position_ms
    if body.track_ids is not None:
        command["track_ids"] = body.track_ids
    if body.current_index is not None:
        command["current_index"] = body.current_index
    if body.client_id is not None:
        command["client_id"] = body.client_id
    if body.mode is not None:
        command["mode"] = body.mode

    result = await jam_service.handle_command(jam["id"], session.did, command)
    if not result:
        raise HTTPException(status_code=400, detail="command failed")
    return result


# ── WebSocket endpoint ─────────────────────────────────────────────


def _is_allowed_ws_origin(ws: WebSocket) -> bool:
    """check if the WebSocket Origin header is allowed.

    WebSocket jams use cookie auth — only the plyr.fm frontend should connect.
    this is intentionally stricter than CORS (which allows any HTTPS origin
    for the public REST API). third-party clients use dev tokens + REST.
    """
    origin = ws.headers.get("origin")
    if not origin:
        return settings.app.debug  # allow missing origin in dev only

    parsed = urlparse(settings.frontend.url)
    allowed = f"{parsed.scheme}://{parsed.netloc}"

    if origin == allowed:
        return True

    # also allow localhost variations in debug
    return settings.app.debug and origin.startswith(
        ("http://localhost:", "http://127.0.0.1:")
    )


async def _get_ws_session(ws: WebSocket) -> Session | None:
    """extract session from WebSocket cookies."""
    session_id = ws.cookies.get("session_id")
    if not session_id:
        return None
    return await get_session(session_id)


@router.websocket("/{code}/ws")
async def jam_websocket(
    ws: WebSocket,
    code: str,
    session_id: Annotated[str | None, Cookie()] = None,
) -> None:
    """WebSocket endpoint for real-time jam sync."""
    # authenticate via cookie
    if not session_id:
        await ws.close(code=4001, reason="authentication required")
        return

    session = await get_session(session_id)
    if not session:
        await ws.close(code=4001, reason="invalid session")
        return

    # look up jam
    jam = await jam_service.get_jam_by_code(code)
    if not jam or not jam["is_active"]:
        await ws.close(code=4004, reason="jam not found or ended")
        return

    jam_id = jam["id"]

    # verify participant membership before accepting
    async with db_session() as db:
        result = await db.execute(
            select(JamParticipant).where(
                JamParticipant.jam_id == jam_id,
                JamParticipant.did == session.did,
                JamParticipant.left_at.is_(None),
            )
        )
        if not result.scalar_one_or_none():
            await ws.close(code=4003, reason="not a participant")
            return

    # origin validation — only allow frontend origin
    if not _is_allowed_ws_origin(ws):
        await ws.close(code=4002, reason="origin not allowed")
        return

    # connection limit — prevent resource exhaustion
    current_count = len(jam_service._connections.get(jam_id, set()))
    if current_count >= MAX_CONNECTIONS_PER_JAM:
        await ws.close(code=4009, reason="jam is full")
        return

    await ws.accept()

    try:
        await jam_service.connect_ws(jam_id, ws, session.did)
        while True:
            try:
                data = await asyncio.wait_for(
                    ws.receive_text(), timeout=IDLE_TIMEOUT_SECONDS
                )
            except TimeoutError:
                logger.info("ws idle timeout in jam %s: %s", jam_id, session.did)
                with contextlib.suppress(RuntimeError, WebSocketDisconnect):
                    await ws.close(code=4008, reason="idle timeout")
                break

            try:
                message = json.loads(data)
                await jam_service.handle_ws_message(jam_id, session.did, message, ws)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "invalid JSON"})
    except WebSocketDisconnect:
        logger.debug("ws disconnected from jam %s: %s", jam_id, session.did)
    except Exception:
        logger.exception("ws error in jam %s", jam_id)
        with contextlib.suppress(RuntimeError, WebSocketDisconnect):
            await ws.close(code=1011, reason="internal error")
    finally:
        await jam_service.disconnect_ws(jam_id, ws)
