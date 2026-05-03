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


class ImageUploadError(ValueError):
    """validation or storage failure for an uploaded image."""


@dataclass
class ImageUploadResult:
    """result of processing an uploaded image."""

    image_id: str
    image_url: str
    thumbnail_url: str | None


async def save_image_with_thumbnail(
    image_data: bytes,
    filename: str,
    *,
    entity_type: str,
    content_type: str | None = None,
    allowed_extensions: frozenset[str] | None = None,
    scan_moderation: bool = True,
) -> ImageUploadResult:
    """validate format, normalize orientation, save to storage, generate thumbnail.

    raises ImageUploadError on validation failure. callers translate to
    their context (HTTPException for sync routes, return-None for upload
    background staging).
    """
    image_format, is_valid = ImageFormat.validate_and_extract(filename, content_type)
    if not is_valid or not image_format:
        raise ImageUploadError("unsupported image type. supported: jpg, png, webp, gif")

    if allowed_extensions:
        ext = f".{image_format.value}"
        if ext not in allowed_extensions:
            supported = ", ".join(sorted(e.lstrip(".") for e in allowed_extensions))
            raise ImageUploadError(
                f"unsupported image type for {entity_type}: .{image_format.value}. supported: {supported}"
            )

    image_data = normalize_orientation(image_data)
    image_id = await storage.save(BytesIO(image_data), filename)
    ext = PurePosixPath(filename).suffix.lower() or f".{image_format.value}"
    image_url = storage.build_image_url(image_id, ext)
    thumbnail_url = await generate_and_save(image_data, image_id, entity_type)

    if scan_moderation and settings.moderation.image_moderation_enabled:
        try:
            from backend._internal.tasks.moderation import (
                schedule_image_moderation_scan,
            )

            await schedule_image_moderation_scan(
                image_id=image_id,
                image_url=image_url,
                content_type=image_format.media_type,
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


async def process_image_upload(
    image: UploadFile,
    entity_type: str,
    *,
    allowed_extensions: frozenset[str] | None = None,
    scan_moderation: bool = True,
) -> ImageUploadResult:
    """chunked-read an UploadFile then save_image_with_thumbnail.

    raises HTTPException on validation failure or oversize.
    """
    if not image.filename:
        raise HTTPException(status_code=400, detail="no filename provided")

    image_data = bytearray()
    while chunk := await image.read(CHUNK_SIZE):
        if len(image_data) + len(chunk) > MAX_IMAGE_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail="image too large (max 20MB)",
            )
        image_data.extend(chunk)

    try:
        return await save_image_with_thumbnail(
            bytes(image_data),
            image.filename,
            entity_type=entity_type,
            content_type=image.content_type,
            allowed_extensions=allowed_extensions,
            scan_moderation=scan_moderation,
        )
    except ImageUploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
