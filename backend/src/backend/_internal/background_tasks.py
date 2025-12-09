"""background task functions for docket.

these functions are registered with docket and executed by workers.
they should be self-contained and handle their own database sessions.
"""

import asyncio
import logging

import logfire

from backend._internal.background import get_docket, is_docket_enabled

logger = logging.getLogger(__name__)


async def scan_copyright(track_id: int, audio_url: str) -> None:
    """scan a track for potential copyright matches.

    this is the docket version of the copyright scan task. when docket
    is enabled (DOCKET_URL set), this provides durability and retries
    compared to fire-and-forget asyncio.create_task().

    args:
        track_id: database ID of the track to scan
        audio_url: public URL of the audio file (R2)
    """
    from backend._internal.moderation import scan_track_for_copyright

    await scan_track_for_copyright(track_id, audio_url)


async def schedule_copyright_scan(track_id: int, audio_url: str) -> None:
    """schedule a copyright scan, using docket if enabled, else asyncio.

    this is the entry point for scheduling copyright scans. it handles
    the docket vs asyncio fallback logic in one place.
    """
    from backend._internal.moderation import scan_track_for_copyright

    if is_docket_enabled():
        try:
            docket = get_docket()
            await docket.add(scan_copyright)(track_id, audio_url)
            logfire.info("scheduled copyright scan via docket", track_id=track_id)
            return
        except Exception as e:
            logfire.warning(
                "docket scheduling failed, falling back to asyncio",
                track_id=track_id,
                error=str(e),
            )

    # fallback: fire-and-forget
    asyncio.create_task(scan_track_for_copyright(track_id, audio_url))  # noqa: RUF006
