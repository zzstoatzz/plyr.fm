"""audio streaming endpoint."""

import logfire
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func, select

from backend._internal import Session, get_optional_session, validate_supporter
from backend.models import Track
from backend.storage import storage
from backend.utilities.database import db_session

router = APIRouter(prefix="/audio", tags=["audio"])


class AudioUrlResponse(BaseModel):
    """response containing direct R2 URL for offline caching."""

    url: str
    file_id: str
    file_type: str | None


@router.get("/{file_id}")
async def stream_audio(
    file_id: str,
    session: Session | None = Depends(get_optional_session),
):
    """stream audio file by redirecting to R2 CDN URL.

    for public tracks: redirects to R2 CDN URL.
    for gated tracks: validates supporter status and returns presigned URL.

    images are served directly via R2 URLs stored in the image_url field,
    not through this endpoint.
    """
    # look up track to get r2_url, file_type, support_gate, and artist_did
    async with db_session() as db:
        # check for duplicates (multiple tracks with same file_id)
        count_result = await db.execute(
            select(func.count()).select_from(Track).where(Track.file_id == file_id)
        )
        count = count_result.scalar()

        if count == 0:
            raise HTTPException(status_code=404, detail="audio file not found")

        if count > 1:
            logfire.warn(
                "multiple tracks found for file_id",
                file_id=file_id,
                count=count,
            )

        # get the track with gating info
        result = await db.execute(
            select(Track.r2_url, Track.file_type, Track.support_gate, Track.artist_did)
            .where(Track.file_id == file_id)
            .order_by(Track.r2_url.is_not(None).desc(), Track.created_at.desc())
            .limit(1)
        )
        track_data = result.first()
        r2_url, file_type, support_gate, artist_did = track_data

    # check if track is gated
    if support_gate is not None:
        return await _handle_gated_audio(
            file_id=file_id,
            file_type=file_type,
            artist_did=artist_did,
            session=session,
        )

    # public track - use cached r2_url if available
    if r2_url and r2_url.startswith("http"):
        return RedirectResponse(url=r2_url)

    # otherwise, get it with the specific extension (single HEAD)
    url = await storage.get_url(file_id, file_type="audio", extension=file_type)
    if not url:
        raise HTTPException(status_code=404, detail="audio file not found")
    return RedirectResponse(url=url)


async def _handle_gated_audio(
    file_id: str,
    file_type: str,
    artist_did: str,
    session: Session | None,
) -> RedirectResponse:
    """handle streaming for supporter-gated content.

    validates that the user is authenticated and supports the artist
    before returning a presigned URL for the private bucket.
    """
    # must be authenticated to access gated content
    if not session:
        raise HTTPException(
            status_code=401,
            detail="authentication required for supporter-gated content",
        )

    # validate supporter status via atprotofans
    validation = await validate_supporter(
        supporter_did=session.did,
        artist_did=artist_did,
    )

    if not validation.valid:
        raise HTTPException(
            status_code=402,
            detail="this track requires supporter access",
            headers={"X-Support-Required": "true"},
        )

    # supporter verified - generate presigned URL for private bucket
    logfire.info(
        "serving gated content to supporter",
        file_id=file_id,
        supporter_did=session.did,
        artist_did=artist_did,
    )

    url = await storage.generate_presigned_url(file_id=file_id, extension=file_type)
    return RedirectResponse(url=url)


@router.get("/{file_id}/url")
async def get_audio_url(
    file_id: str,
    session: Session | None = Depends(get_optional_session),
) -> AudioUrlResponse:
    """return direct URL for audio file.

    for public tracks: returns R2 CDN URL for offline caching.
    for gated tracks: returns presigned URL after supporter validation.

    used for offline mode - frontend fetches and caches locally.
    """
    async with db_session() as db:
        result = await db.execute(
            select(Track.r2_url, Track.file_type, Track.support_gate, Track.artist_did)
            .where(Track.file_id == file_id)
            .order_by(Track.r2_url.is_not(None).desc(), Track.created_at.desc())
            .limit(1)
        )
        track_data = result.first()

        if not track_data:
            raise HTTPException(status_code=404, detail="audio file not found")

        r2_url, file_type, support_gate, artist_did = track_data

    # check if track is gated
    if support_gate is not None:
        # must be authenticated
        if not session:
            raise HTTPException(
                status_code=401,
                detail="authentication required for supporter-gated content",
            )

        # validate supporter status
        validation = await validate_supporter(
            supporter_did=session.did,
            artist_did=artist_did,
        )

        if not validation.valid:
            raise HTTPException(
                status_code=402,
                detail="this track requires supporter access",
                headers={"X-Support-Required": "true"},
            )

        # return presigned URL
        url = await storage.generate_presigned_url(file_id=file_id, extension=file_type)
        return AudioUrlResponse(url=url, file_id=file_id, file_type=file_type)

    # public track - return cached r2_url if available
    if r2_url and r2_url.startswith("http"):
        return AudioUrlResponse(url=r2_url, file_id=file_id, file_type=file_type)

    # otherwise, resolve it
    url = await storage.get_url(file_id, file_type="audio", extension=file_type)
    if not url:
        raise HTTPException(status_code=404, detail="audio file not found")

    return AudioUrlResponse(url=url, file_id=file_id, file_type=file_type)
