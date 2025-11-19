"""audio streaming endpoint."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import select

from backend._internal.audio import AudioFormat
from backend.config import settings
from backend.models import Track
from backend.storage import storage
from backend.utilities.database import db_session

router = APIRouter(prefix="/audio", tags=["audio"])


@router.get("/{file_id}")
async def stream_audio(file_id: str):
    """stream audio file by redirecting to R2 CDN URL.

    looks up the track to get the r2_url and file extension,
    eliminating the need to probe multiple formats.

    images are served directly via R2 URLs stored in the image_url field,
    not through this endpoint.
    """
    # look up track to get r2_url and file_type
    async with db_session() as db:
        result = await db.execute(
            select(Track.r2_url, Track.file_type).where(Track.file_id == file_id)
        )
        track_data = result.one_or_none()

        if not track_data:
            raise HTTPException(status_code=404, detail="audio file not found")

        r2_url, file_type = track_data

    if settings.storage.backend == "r2":
        # R2: redirect to public URL
        from backend.storage.r2 import R2Storage

        if isinstance(storage, R2Storage):
            # if we have the r2_url already, use it directly (zero HEADs)
            if r2_url:
                return RedirectResponse(url=r2_url)

            # otherwise, get it with the specific extension (single HEAD)
            url = await storage.get_url(file_id, file_type="audio", extension=file_type)
            if not url:
                raise HTTPException(status_code=404, detail="audio file not found")
            return RedirectResponse(url=url)

    # filesystem: serve file directly
    from backend.storage.filesystem import FilesystemStorage

    if not isinstance(storage, FilesystemStorage):
        raise HTTPException(status_code=500, detail="invalid storage backend")

    file_path = storage.get_path(file_id)

    if not file_path:
        raise HTTPException(status_code=404, detail="audio file not found")

    # determine audio media type
    audio_format = AudioFormat.from_extension(file_path.suffix)
    media_type = audio_format.media_type if audio_format else "application/octet-stream"

    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=file_path.name,
    )
