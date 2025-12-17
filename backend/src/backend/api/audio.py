"""audio streaming endpoint."""

import logfire
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import func, select

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
async def stream_audio(file_id: str):
    """stream audio file by redirecting to R2 CDN URL.

    looks up track to get cached r2_url and file extension,
    eliminating the need to probe multiple formats.

    images are served directly via R2 URLs stored in the image_url field,
    not through this endpoint.
    """
    # look up track to get r2_url and file_type
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

        # get the best track: prefer non-null r2_url, then newest
        result = await db.execute(
            select(Track.r2_url, Track.file_type)
            .where(Track.file_id == file_id)
            .order_by(Track.r2_url.is_not(None).desc(), Track.created_at.desc())
            .limit(1)
        )
        track_data = result.first()

        r2_url, file_type = track_data

    # if we have a valid r2_url cached, use it directly (zero HEADs)
    if r2_url and r2_url.startswith("http"):
        return RedirectResponse(url=r2_url)

    # otherwise, get it with the specific extension (single HEAD)
    url = await storage.get_url(file_id, file_type="audio", extension=file_type)
    if not url:
        raise HTTPException(status_code=404, detail="audio file not found")
    return RedirectResponse(url=url)


@router.get("/{file_id}/url")
async def get_audio_url(file_id: str) -> AudioUrlResponse:
    """return direct R2 URL for offline caching.

    unlike the streaming endpoint which returns a 307 redirect,
    this returns the URL as JSON so the frontend can fetch and
    cache the audio directly via the Cache API.

    used for offline mode - frontend fetches from R2 and stores locally.
    """
    async with db_session() as db:
        result = await db.execute(
            select(Track.r2_url, Track.file_type)
            .where(Track.file_id == file_id)
            .order_by(Track.r2_url.is_not(None).desc(), Track.created_at.desc())
            .limit(1)
        )
        track_data = result.first()

        if not track_data:
            raise HTTPException(status_code=404, detail="audio file not found")

        r2_url, file_type = track_data

    # if we have a cached r2_url, return it
    if r2_url and r2_url.startswith("http"):
        return AudioUrlResponse(url=r2_url, file_id=file_id, file_type=file_type)

    # otherwise, resolve it
    url = await storage.get_url(file_id, file_type="audio", extension=file_type)
    if not url:
        raise HTTPException(status_code=404, detail="audio file not found")

    return AudioUrlResponse(url=url, file_id=file_id, file_type=file_type)
