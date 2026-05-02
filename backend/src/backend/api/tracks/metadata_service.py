"""Helpers for track metadata updates."""

import asyncio
import json
import logging
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import attributes
from starlette.datastructures import UploadFile

from backend._internal.atproto.handles import resolve_handle
from backend._internal.image_uploads import process_image_upload
from backend.models import Track

from .constants import MAX_FEATURES
from .services import get_or_create_album

logger = logging.getLogger(__name__)


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
        if TYPE_CHECKING:
            assert isinstance(resolved, dict)
        # store only the canonical DID. handle/displayName are mutable
        # snapshots that the API hydrates fresh per-request via
        # `_internal.atproto.profiles.resolve_dids`. keeping them here
        # would re-introduce the drift bug fixed by #1355.
        features.append({"did": resolved["did"]})

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
        album_record, album_created = await get_or_create_album(
            db,
            track.artist,
            album_value,
            track.image_id,
            track.image_url,
        )
        track.album_id = album_record.id

        if album_created:
            from backend.models import CollectionEvent

            db.add(
                CollectionEvent(
                    event_type="album_release",
                    actor_did=track.artist_did,
                    album_id=album_record.id,
                )
            )
    else:
        if track.extra and "album" in track.extra:
            del track.extra["album"]
            attributes.flag_modified(track, "extra")
        track.album_id = None

    return True


async def upload_track_image(
    image: UploadFile,
) -> tuple[str, str | None, str | None]:
    """Persist a track image and return (image_id, public_url, thumbnail_url)."""
    uploaded = await process_image_upload(image, "track")
    return uploaded.image_id, uploaded.image_url, uploaded.thumbnail_url
