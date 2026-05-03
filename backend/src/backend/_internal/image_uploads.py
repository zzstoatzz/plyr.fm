"""shared image upload processing: validation, storage, thumbnails, moderation."""

import logging
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath

from fastapi import HTTPException
from starlette.datastructures import UploadFile

from backend._internal.image import ImageFormat, normalize_orientation
from backend._internal.thumbnails import generate_and_save
from backend.config import settings
from backend.storage import storage
from backend.utilities.hashing import CHUNK_SIZE

logger = logging.getLogger(__name__)

MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024  # 20MB

# album/playlist covers don't support GIF; track artwork does via ImageFormat
COVER_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".webp"})


@dataclass
class ImageUploadResult:
    """result of processing an uploaded image."""

    image_id: str
    image_url: str
    thumbnail_url: str | None


async def process_image_upload(
    image: UploadFile,
    entity_type: str,
    *,
    allowed_extensions: frozenset[str] | None = None,
    scan_moderation: bool = True,
) -> ImageUploadResult:
    """validate, store, thumbnail, and optionally moderate an uploaded image.

    uses ImageFormat.validate_and_extract for validation, which prefers
    content_type over filename extension (handles iOS HEIC→JPEG conversions).

    args:
        image: the uploaded file
        entity_type: context label for thumbnails/moderation (e.g. "album", "playlist", "track")
        allowed_extensions: if set, restrict accepted formats to these extensions
            (e.g. COVER_EXTENSIONS for album/playlist covers). when None, accepts
            all formats supported by ImageFormat (jpg, png, webp, gif).
        scan_moderation: whether to run moderation scanning (default True)

    returns:
        ImageUploadResult with image_id, image_url, and optional thumbnail_url

    raises:
        HTTPException: on validation failure or storage error
    """
    if not image.filename:
        raise HTTPException(status_code=400, detail="no filename provided")

    image_format, is_valid = ImageFormat.validate_and_extract(
        image.filename, image.content_type
    )
    if not is_valid:
        raise HTTPException(
            status_code=400,
            detail="unsupported image type. supported: jpg, png, webp, gif",
        )

    # enforce narrower extension set when caller requires it (e.g. album/playlist covers)
    if allowed_extensions and image_format:
        ext = f".{image_format.value}"
        if ext not in allowed_extensions:
            supported = ", ".join(sorted(e.lstrip(".") for e in allowed_extensions))
            raise HTTPException(
                status_code=400,
                detail=f"unsupported image type for {entity_type}: .{image_format.value}. supported: {supported}",
            )

    # chunked read with size limit
    image_data = bytearray()
    while chunk := await image.read(CHUNK_SIZE):
        if len(image_data) + len(chunk) > MAX_IMAGE_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail="image too large (max 20MB)",
            )
        image_data.extend(chunk)

    image_data = bytearray(normalize_orientation(bytes(image_data)))
    image_obj = BytesIO(image_data)
    image_id = await storage.save(image_obj, image.filename)
    # use the actual filename extension — must match the key R2.save() stored
    ext = PurePosixPath(image.filename).suffix.lower() or ".png"
    image_url = storage.build_image_url(image_id, ext)
    thumbnail_url = await generate_and_save(bytes(image_data), image_id, entity_type)

    # moderation scanning — dispatched as a docket background task so the
    # HTTP response isn't blocked on the moderation service round trip
    # (~3-6s for claude vision + possible cold-start penalty).  the scan
    # only flags and notifies; it never gates the response.
    if scan_moderation and settings.moderation.image_moderation_enabled:
        try:
            from backend._internal.tasks.moderation import (
                schedule_image_moderation_scan,
            )

            content_type = image_format.media_type if image_format else "image/png"
            await schedule_image_moderation_scan(
                image_id=image_id,
                image_url=image_url,
                content_type=content_type,
                entity_type=entity_type,
            )
        except Exception as e:
            logger.warning(
                "failed to schedule image moderation for %s: %s", image_id, e
            )

    return ImageUploadResult(
        image_id=image_id,
        image_url=image_url,
        thumbnail_url=thumbnail_url,
    )
