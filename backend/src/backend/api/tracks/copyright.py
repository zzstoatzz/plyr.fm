"""Per-track rights metadata, independent of publication permissions."""

import logging
from typing import Annotated

from fastapi import Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session as AuthSession
from backend._internal import require_auth
from backend._internal.copyright import (
    TrackRightsInput,
    clear_track_rights,
    write_track_rights,
)
from backend.api.copyright import _require_copyright_flag
from backend.models import Track, get_db

from .router import router

logger = logging.getLogger(__name__)


class TrackCopyrightResponse(BaseModel):
    """rights metadata pointers for a track."""

    song_uri: str | None
    recording_uri: str | None


async def _load_owned_track(
    db: AsyncSession, track_id: int, auth_session: AuthSession
) -> Track:
    result = await db.execute(select(Track).where(Track.id == track_id))
    track = result.scalar_one_or_none()
    if not track:
        raise HTTPException(status_code=404, detail="track not found")
    if track.artist_did != auth_session.did:
        raise HTTPException(status_code=403, detail="you can only edit your own tracks")
    return track


@router.post("/{track_id}/copyright")
async def set_track_copyright(
    track_id: int,
    body: TrackRightsInput,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> TrackCopyrightResponse:
    """Write or update rights information without changing access."""
    await _require_copyright_flag(auth_session)
    track = await _load_owned_track(db, track_id, auth_session)
    try:
        result = await write_track_rights(auth_session, track, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return TrackCopyrightResponse(
        song_uri=result.song_uri,
        recording_uri=result.recording_uri,
    )


@router.delete("/{track_id}/copyright")
async def clear_track_copyright(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> TrackCopyrightResponse:
    """Delete rights records without changing access."""
    await _require_copyright_flag(auth_session)
    track = await _load_owned_track(db, track_id, auth_session)
    await clear_track_rights(auth_session, track)
    return TrackCopyrightResponse(song_uri=None, recording_uri=None)
