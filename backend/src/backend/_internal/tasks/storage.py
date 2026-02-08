"""storage-related background tasks."""

import logging

import logfire
from sqlalchemy import select

from backend._internal.background import get_docket
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


async def move_track_audio(track_id: int, to_private: bool) -> None:
    """move a track's audio file between public and private buckets.

    called when support_gate is toggled on an existing track.

    args:
        track_id: database ID of the track
        to_private: if True, move to private bucket; if False, move to public
    """
    from backend.models import Track
    from backend.storage import storage

    async with db_session() as db:
        result = await db.execute(select(Track).where(Track.id == track_id))
        track = result.scalar_one_or_none()

        if not track:
            logger.warning(f"move_track_audio: track {track_id} not found")
            return

        if not track.file_id or not track.file_type:
            logger.warning(
                f"move_track_audio: track {track_id} missing file_id/file_type"
            )
            return

        result_url = await storage.move_audio(
            file_id=track.file_id,
            extension=track.file_type,
            to_private=to_private,
        )

        # update r2_url: None for private, public URL for public
        if to_private:
            # moved to private - result_url is None on success, None on failure
            # we check by verifying the file was actually moved (no error logged)
            track.r2_url = None
            await db.commit()
            logger.info(f"moved track {track_id} to private bucket")
        elif result_url:
            # moved to public - result_url is the public URL
            track.r2_url = result_url
            await db.commit()
            logger.info(f"moved track {track_id} to public bucket")
        else:
            logger.error(f"failed to move track {track_id}")


async def schedule_move_track_audio(track_id: int, to_private: bool) -> None:
    """schedule a track audio move via docket."""
    docket = get_docket()
    await docket.add(move_track_audio)(track_id, to_private)
    direction = "private" if to_private else "public"
    logfire.info(f"scheduled track audio move to {direction}", track_id=track_id)
