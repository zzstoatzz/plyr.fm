"""jam api endpoints for shared listening rooms."""

import json
import logging
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    Cookie,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
)
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, has_flag, jam_service, require_auth
from backend._internal.auth.session import get_session
from backend.models import get_db
from backend.models.jam import JamParticipant
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jams", tags=["jams"])

JAMS_FLAG = "jams"


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
    index: int | None = None
    client_id: str | None = None


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


# ── flag check helper ──────────────────────────────────────────────


async def _require_jams_flag(session: Session, db: AsyncSession) -> None:
    """raise 403 if user doesn't have the jams flag."""
    if not await has_flag(db, session.did, JAMS_FLAG):
        raise HTTPException(status_code=403, detail="jams feature not enabled")


# ── REST endpoints ─────────────────────────────────────────────────


@router.post("/", response_model=JamResponse)
async def create_jam(
    body: CreateJamRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> JamResponse:
    """create a new jam."""
    await _require_jams_flag(session, db)
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
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> JamResponse | None:
    """get the user's current active jam."""
    await _require_jams_flag(session, db)
    result = await jam_service.get_active_jam(session.did)
    if not result:
        return None
    return JamResponse(**result)


@router.get("/{code}", response_model=JamResponse)
async def get_jam(
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> JamResponse:
    """get jam details by code."""
    await _require_jams_flag(session, db)
    result = await jam_service.get_jam_by_code(code)
    if not result:
        raise HTTPException(status_code=404, detail="jam not found")
    return JamResponse(**result)


@router.post("/{code}/join", response_model=JamResponse)
async def join_jam(
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> JamResponse:
    """join a jam."""
    await _require_jams_flag(session, db)
    result = await jam_service.join_jam(code, session.did)
    if not result:
        raise HTTPException(status_code=404, detail="jam not found or not active")
    return JamResponse(**result)


@router.post("/{code}/leave")
async def leave_jam(
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> dict[str, bool]:
    """leave a jam."""
    await _require_jams_flag(session, db)
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
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> dict[str, bool]:
    """end a jam (host only)."""
    await _require_jams_flag(session, db)
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
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> dict[str, Any]:
    """send a playback command to the jam."""
    await _require_jams_flag(session, db)
    jam = await jam_service.get_jam_by_code(code)
    if not jam:
        raise HTTPException(status_code=404, detail="jam not found")

    command: dict[str, Any] = {"type": body.type}
    if body.position_ms is not None:
        command["position_ms"] = body.position_ms
    if body.track_ids is not None:
        command["track_ids"] = body.track_ids
    if body.index is not None:
        command["index"] = body.index
    if body.client_id is not None:
        command["client_id"] = body.client_id

    result = await jam_service.handle_command(jam["id"], session.did, command)
    if not result:
        raise HTTPException(status_code=400, detail="command failed")
    return result


# ── WebSocket endpoint ─────────────────────────────────────────────


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

    # verify flag
    async with db_session() as db:
        if not await has_flag(db, session.did, JAMS_FLAG):
            await ws.close(code=4003, reason="jams feature not enabled")
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

    await ws.accept()

    try:
        await jam_service.connect_ws(jam_id, ws, session.did)
        while True:
            data = await ws.receive_text()
            try:
                message = json.loads(data)
                await jam_service.handle_ws_message(jam_id, session.did, message, ws)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "invalid JSON"})
    except WebSocketDisconnect:
        logger.debug("ws disconnected from jam %s: %s", jam_id, session.did)
    except Exception:
        logger.exception("ws error in jam %s", jam_id)
    finally:
        await jam_service.disconnect_ws(jam_id, ws)
