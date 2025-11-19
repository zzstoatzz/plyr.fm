"""audio streaming endpoint."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from backend._internal.audio import AudioFormat
from backend.config import settings
from backend.storage import storage

router = APIRouter(prefix="/audio", tags=["audio"])


@router.get("/{file_id}")
async def stream_audio(file_id: str):
    """stream audio file by redirecting to R2 CDN URL.

    images are served directly via R2 URLs stored in the image_url field,
    not through this endpoint.
    """

    if settings.storage.backend == "r2":
        # R2: redirect to public URL
        from backend.storage.r2 import R2Storage

        if isinstance(storage, R2Storage):
            url = await storage.get_url(file_id, file_type="audio")
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
