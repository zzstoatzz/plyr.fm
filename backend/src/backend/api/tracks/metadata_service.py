"""Track metadata mutations that need cross-table bookkeeping."""

import logging

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import attributes

from backend.models import Track

from .services import get_or_create_album

logger = logging.getLogger(__name__)


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
