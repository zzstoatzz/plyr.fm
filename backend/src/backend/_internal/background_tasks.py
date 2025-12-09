"""background task functions for docket.

these functions are registered with docket and executed by workers.
they should be self-contained and handle their own database sessions.

note: for now, process_upload is a stub - the actual upload processing
still uses FastAPI BackgroundTasks. this module demonstrates the pattern
and handles copyright scanning as the first migrated task.
"""

import logging

logger = logging.getLogger(__name__)


async def scan_copyright(track_id: int, audio_url: str) -> None:
    """scan a track for potential copyright matches.

    this is the docket version of the copyright scan task. it replaces
    the fire-and-forget asyncio.create_task() call with a durable,
    retriable background task.

    args:
        track_id: database ID of the track to scan
        audio_url: public URL of the audio file (R2)
    """
    # delegate to the existing implementation
    from backend._internal.moderation import scan_track_for_copyright

    await scan_track_for_copyright(track_id, audio_url)


async def process_upload(
    upload_id: str,
    file_path: str,
    filename: str,
    title: str,
    artist_did: str,
    album: str | None,
    features: str | None,
    validated_tags: list[str],
    # note: auth_session cannot be passed through docket (not serializable)
    # this is a limitation - uploads still need FastAPI BackgroundTasks
    # until we refactor to pass only serializable data
) -> None:
    """process an uploaded track file.

    STUB: this is not yet implemented for docket. the upload flow requires
    the auth_session for ATProto operations, which isn't serializable.

    for now, uploads continue using FastAPI BackgroundTasks. this function
    exists to demonstrate the pattern and can be implemented once we
    refactor the auth handling (e.g., store session ID and re-fetch).
    """
    logger.warning(
        "process_upload called via docket but not implemented - "
        "uploads should still use FastAPI BackgroundTasks",
        extra={"upload_id": upload_id},
    )
    raise NotImplementedError(
        "upload processing via docket not yet implemented - "
        "auth_session serialization needs refactoring"
    )
