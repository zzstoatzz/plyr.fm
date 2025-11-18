"""Helpers for track metadata updates."""

from __future__ import annotations

import asyncio
import json
from io import BytesIO
from typing import Any

from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import attributes

from backend._internal.atproto.handles import resolve_handle
from backend._internal.image import ImageFormat
from backend.config import settings
from backend.models import Track
from backend.storage import storage
from backend.storage.r2 import R2Storage

from .constants import MAX_FEATURES
from .services import get_or_create_album

MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024  # 20MB


async def resolve_feature_handles(
    features_json: str, *, artist_handle: str
) -> list[dict[str, Any]]:
    """Parse and resolve feature handles from JSON."""
    try:
        handles_list = json.loads(features_json)
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=400, detail=f"invalid JSON in features: {exc}"
        ) from exc

    if not isinstance(handles_list, list):
        raise HTTPException(
            status_code=400, detail="features must be a JSON array of handles"
        )

    if len(handles_list) > MAX_FEATURES:
        raise HTTPException(
            status_code=400,
            detail=f"maximum {MAX_FEATURES} featured artists allowed",
        )

    valid_handles: list[str] = []
    for handle in handles_list:
        if not isinstance(handle, str):
            raise HTTPException(
                status_code=400, detail="each feature must be a string handle"
            )
        # prevent self-featuring
        if handle.lstrip("@") == artist_handle:
            continue
        valid_handles.append(handle)

    if not valid_handles:
        return []

    resolved_artists = await asyncio.gather(
        *[resolve_handle(h) for h in valid_handles],
        return_exceptions=True,
    )

    features: list[dict[str, Any]] = []
    for handle, resolved in zip(valid_handles, resolved_artists, strict=False):
        if isinstance(resolved, Exception) or not resolved:
            raise HTTPException(
                status_code=400,
                detail=f"failed to resolve handle: {handle}",
            )
        features.append(resolved)

    return features


async def apply_album_update(
    db: AsyncSession,
    track: Track,
    album_value: str | None,
) -> bool:
    """Apply album updates to the track, returning whether a change occurred."""
    if album_value is None:
        return False

    if album_value:
        if track.extra is None:
            track.extra = {}
        track.extra["album"] = album_value
        attributes.flag_modified(track, "extra")
        album_record = await get_or_create_album(
            db,
            track.artist,
            album_value,
            track.image_id,
            track.image_url,
        )
        track.album_id = album_record.id
    else:
        if track.extra and "album" in track.extra:
            del track.extra["album"]
            attributes.flag_modified(track, "extra")
        track.album_id = None

    return True


async def upload_track_image(image: UploadFile) -> tuple[str, str | None]:
    """Persist a track image and return (image_id, public_url)."""
    if not image.filename:
        raise HTTPException(status_code=400, detail="image filename missing")

    _image_format, is_valid = ImageFormat.validate_and_extract(image.filename)
    if not is_valid:
        raise HTTPException(
            status_code=400,
            detail="unsupported image type. supported: jpg, png, webp, gif",
        )

    image_data = await image.read()
    if len(image_data) > MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="image too large (max 20MB)",
        )

    image_obj = BytesIO(image_data)
    image_id = await storage.save(image_obj, f"images/{image.filename}")

    image_url = None
    if settings.storage.backend == "r2" and isinstance(storage, R2Storage):
        image_url = await storage.get_url(image_id)

    return image_id, image_url
