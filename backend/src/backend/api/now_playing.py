"""now playing API endpoints for external scrobbler integrations.

exposes real-time playback state for services like teal.fm/Piper.

note: these endpoints are exempt from rate limiting because they're
already throttled client-side (10-second intervals, 1-second debounce).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend._internal import Session, now_playing_service, require_auth
from backend.config import settings
from backend.models import Artist, get_db
from backend.schemas import StatusResponse
from backend.utilities.rate_limit import limiter

router = APIRouter(prefix="/now-playing", tags=["now-playing"])


class NowPlayingUpdate(BaseModel):
    """request to update now playing state."""

    track_id: int
    file_id: str
    track_name: str
    artist_name: str
    album_name: str | None = None
    duration_ms: int
    progress_ms: int
    is_playing: bool
    image_url: str | None = None


class NowPlayingResponse(BaseModel):
    """now playing state response.

    designed to be compatible with teal.fm/Piper expectations.
    matches the fields Piper expects from music sources like Spotify.
    """

    # track metadata (required by teal.fm lexicon)
    track_name: str
    artist_name: str
    album_name: str | None

    # playback state
    duration_ms: int
    progress_ms: int
    is_playing: bool

    # plyr.fm-specific identifiers
    track_id: int
    file_id: str
    track_url: str
    image_url: str | None

    # service identifier for Piper (domain extracted from frontend URL)
    service_base_url: str


@router.post("/")
@limiter.exempt
async def update_now_playing(
    update: NowPlayingUpdate,
    session: Session = Depends(require_auth),
) -> StatusResponse:
    """update now playing state (authenticated).

    called by frontend to report current playback state.
    state expires after 5 minutes of no updates.
    """
    track_url = f"{settings.frontend.url}/track/{update.track_id}"

    now_playing_service.update(
        did=session.did,
        track_name=update.track_name,
        artist_name=update.artist_name,
        album_name=update.album_name,
        duration_ms=update.duration_ms,
        progress_ms=update.progress_ms,
        track_id=update.track_id,
        file_id=update.file_id,
        track_url=track_url,
        image_url=update.image_url,
        is_playing=update.is_playing,
    )

    return StatusResponse(status="ok")


@router.delete("/")
@limiter.exempt
async def clear_now_playing(
    session: Session = Depends(require_auth),
) -> StatusResponse:
    """clear now playing state (authenticated).

    called when user explicitly stops playback.
    """
    now_playing_service.clear(session.did)
    return StatusResponse(status="ok")


@router.get("/by-handle/{handle}")
@limiter.exempt
async def get_now_playing_by_handle(
    handle: str,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> NowPlayingResponse:
    """get now playing state by handle (public).

    this is the endpoint Piper will poll to fetch current playback state.
    returns 204 No Content if nothing is playing.

    response format matches what Piper expects from music sources:
    - track_name: track title
    - artist_name: artist display name
    - album_name: album name (optional)
    - duration_ms: total duration in milliseconds
    - progress_ms: current playback position in milliseconds
    - is_playing: whether actively playing
    - track_url: link to track on plyr.fm
    - service_base_url: "plyr.fm" for Piper to identify the source
    """
    # resolve handle to DID
    result = await db.execute(select(Artist.did).where(Artist.handle == handle))
    did = result.scalar_one_or_none()

    if not did:
        raise HTTPException(status_code=404, detail="user not found")

    state = now_playing_service.get(did)

    if not state or not state.is_playing:
        # nothing playing - return 204 like Spotify does
        response.status_code = 204
        # must return something for FastAPI, but 204 has no body
        raise HTTPException(status_code=204)

    return NowPlayingResponse(
        track_name=state.track_name,
        artist_name=state.artist_name,
        album_name=state.album_name,
        duration_ms=state.duration_ms,
        progress_ms=state.progress_ms,
        is_playing=state.is_playing,
        track_id=state.track_id,
        file_id=state.file_id,
        track_url=state.track_url,
        image_url=state.image_url,
        service_base_url=settings.frontend.domain,
    )


@router.get("/by-did/{did}")
@limiter.exempt
async def get_now_playing_by_did(
    did: str,
    response: Response,
) -> NowPlayingResponse:
    """get now playing state by DID (public).

    alternative to by-handle for clients that already have the DID.
    returns 204 No Content if nothing is playing.
    """
    state = now_playing_service.get(did)

    if not state or not state.is_playing:
        raise HTTPException(status_code=204)

    return NowPlayingResponse(
        track_name=state.track_name,
        artist_name=state.artist_name,
        album_name=state.album_name,
        duration_ms=state.duration_ms,
        progress_ms=state.progress_ms,
        is_playing=state.is_playing,
        track_id=state.track_id,
        file_id=state.file_id,
        track_url=state.track_url,
        image_url=state.image_url,
        service_base_url=settings.frontend.domain,
    )
