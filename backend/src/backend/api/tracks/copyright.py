"""per-track copyright endpoints.

POST /tracks/{track_id}/copyright — write or update rights metadata (song +
recording records on the user's PDS) for a track. flips the track into private
storage by setting support_gate = {"type": "copyright"}.

DELETE /tracks/{track_id}/copyright — best-effort delete the song + recording
records, clear the URI columns, and (when support_gate was set to copyright)
clear the gate. moving the audio back to the public bucket is a follow-up if
we want it.
"""

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
from backend.models import Track, get_db

from .router import router

logger = logging.getLogger(__name__)


class TrackCopyrightResponse(BaseModel):
    """rights metadata pointers for a track."""

    song_uri: str | None
    recording_uri: str | None
    is_copyright_gated: bool


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
    """write/update indiemusi rights records for this track.

    creates a fresh song + recording on first call, updates existing rkeys on
    subsequent calls. always flips the track into copyright gating.
    """
    track = await _load_owned_track(db, track_id, auth_session)
    try:
        result = await write_track_rights(auth_session, track, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return TrackCopyrightResponse(
        song_uri=result.song_uri,
        recording_uri=result.recording_uri,
        is_copyright_gated=True,
    )


@router.delete("/{track_id}/copyright")
async def clear_track_copyright(
    track_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    auth_session: AuthSession = Depends(require_auth),
) -> TrackCopyrightResponse:
    """delete rights records for this track and clear the columns + gate."""
    track = await _load_owned_track(db, track_id, auth_session)
    await clear_track_rights(auth_session, track)
    return TrackCopyrightResponse(
        song_uri=None, recording_uri=None, is_copyright_gated=False
    )
