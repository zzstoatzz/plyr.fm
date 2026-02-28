"""device presence api endpoints for cross-session playback awareness."""

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from backend._internal import Session, require_auth
from backend._internal.auth.session import get_session
from backend._internal.devices import device_service
from backend.utilities.user_agent import parse_device_name

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/devices", tags=["devices"])


# ── response models ───────────────────────────────────────────────


class DeviceResponse(BaseModel):
    device_id: str
    name: str
    is_playing: bool
    current_track_id: str | None
    progress_ms: int
    last_seen: int


# ── REST endpoints ─────────────────────────────────────────────────


@router.get("/", response_model=list[DeviceResponse])
async def list_devices(
    session: Session = Depends(require_auth),
) -> list[DeviceResponse]:
    """list the user's registered devices."""
    devices = await device_service.get_devices(session.did)
    return [DeviceResponse(**d) for d in devices]


# ── WebSocket endpoint ─────────────────────────────────────────────


@router.websocket("/ws")
async def device_websocket(
    ws: WebSocket,
    session_id: Annotated[str | None, Cookie()] = None,
) -> None:
    """WebSocket endpoint for device presence.

    protocol:
    - client sends: { type: "register", device_id, name }
    - client sends every 30s: { type: "heartbeat", is_playing, current_track_id, progress_ms }
    - client sends: { type: "transfer", target_device_id }
    - server pushes: { type: "devices_updated", devices: [...] }
    - server pushes: { type: "transfer_in", state, tracks, progress_ms }
    - server pushes: { type: "transfer_out" }
    """
    # authenticate via cookie
    if not session_id:
        await ws.close(code=4001, reason="authentication required")
        return

    session = await get_session(session_id)
    if not session:
        await ws.close(code=4001, reason="invalid session")
        return

    await ws.accept()

    device_id: str | None = None
    ua = ws.headers.get("user-agent", "")

    try:
        while True:
            data = await ws.receive_text()
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "message": "invalid JSON"})
                continue

            msg_type = message.get("type")

            # first message must be register
            if device_id is None and msg_type != "register":
                await ws.send_json({"type": "error", "message": "must register first"})
                continue

            if msg_type == "register":
                device_id = message.get("device_id")
                if not device_id:
                    await ws.send_json(
                        {"type": "error", "message": "device_id required"}
                    )
                    continue
                # use client-provided name, or derive from user-agent
                name = message.get("name") or parse_device_name(ua)
                await device_service.handle_ws_message(
                    session.did,
                    device_id,
                    {"type": "register", "name": name},
                    ws,
                )
            else:
                await device_service.handle_ws_message(
                    session.did,
                    device_id,  # type: ignore[arg-type]
                    message,
                    ws,
                )
    except WebSocketDisconnect:
        logger.debug("device ws disconnected: %s/%s", session.did, device_id)
    except Exception:
        logger.exception("device ws error: %s/%s", session.did, device_id)
    finally:
        if device_id:
            await device_service.unregister_device(session.did, device_id)
