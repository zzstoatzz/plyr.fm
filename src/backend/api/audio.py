"""media streaming endpoints (audio and images)."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from backend._internal.audio import AudioFormat
from backend._internal.image import ImageFormat
from backend.config import settings
from backend.storage import storage

router = APIRouter(prefix="/audio", tags=["audio"])


@router.get("/{file_id}")
async def stream_media(file_id: str):
    """stream media file (audio or image)."""

    if settings.storage.backend == "r2":
        # R2: redirect to public URL
        from backend.storage.r2 import R2Storage

        if isinstance(storage, R2Storage):
            url = await storage.get_url(file_id)
            if not url:
                raise HTTPException(status_code=404, detail="media file not found")
            return RedirectResponse(url=url)

    # filesystem: serve file directly
    from backend.storage.filesystem import FilesystemStorage

    if not isinstance(storage, FilesystemStorage):
        raise HTTPException(status_code=500, detail="invalid storage backend")

    file_path = storage.get_path(file_id)

    if not file_path:
        raise HTTPException(status_code=404, detail="media file not found")

    # determine media type based on extension
    ext = file_path.suffix

    # try audio first
    audio_format = AudioFormat.from_extension(ext)
    if audio_format:
        media_type = audio_format.media_type
    else:
        # try image
        image_format = ImageFormat.from_filename(file_path.name)
        if image_format:
            media_type = image_format.media_type
        else:
            # fallback
            media_type = "application/octet-stream"

    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=file_path.name,
    )
