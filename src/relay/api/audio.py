"""audio streaming endpoints."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from relay.config import settings
from relay.models import AudioFormat
from relay.storage import storage

router = APIRouter(prefix="/audio", tags=["audio"])


@router.get("/{file_id}")
async def stream_audio(file_id: str):
    """stream audio file."""

    if settings.storage_backend == "r2":
        # R2: redirect to public URL
        from relay.storage.r2 import R2Storage
        if isinstance(storage, R2Storage):
            url = storage.get_url(file_id)
            if not url:
                raise HTTPException(status_code=404, detail="audio file not found")
            return RedirectResponse(url=url)

    # filesystem: serve file directly
    file_path = storage.get_path(file_id)

    if not file_path:
        raise HTTPException(status_code=404, detail="audio file not found")

    # determine media type based on extension
    audio_format = AudioFormat.from_extension(file_path.suffix)
    media_type = audio_format.media_type if audio_format else "audio/mpeg"

    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=file_path.name,
    )
