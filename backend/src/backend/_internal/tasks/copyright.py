"""copyright scanning and resolution sync background tasks."""

import logging
from datetime import timedelta

import logfire
from docket import Perpetual
from sqlalchemy import select

from backend._internal.background import get_docket
from backend.models import CopyrightScan, Track
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


async def scan_copyright(track_id: int, audio_url: str) -> None:
    """scan a track for potential copyright matches.

    args:
        track_id: database ID of the track to scan
        audio_url: public URL of the audio file (R2)
    """
    from backend._internal.moderation import scan_track_for_copyright

    await scan_track_for_copyright(track_id, audio_url)


async def schedule_copyright_scan(track_id: int, audio_url: str) -> None:
    """schedule a copyright scan via docket."""
    docket = get_docket()
    await docket.add(scan_copyright)(track_id, audio_url)
    logfire.info("scheduled copyright scan", track_id=track_id)


async def sync_copyright_resolutions(
    perpetual: Perpetual = Perpetual(every=timedelta(minutes=5), automatic=True),  # noqa: B008
) -> None:
    """sync resolution status from labeler to backend database.

    finds tracks that are flagged but have no resolution, checks the labeler
    to see if the labels were negated (dismissed), and marks them as resolved.

    this replaces the lazy reconciliation that was happening on read paths.
    runs automatically every 5 minutes via docket's Perpetual.
    """
    from backend._internal.clients.moderation import get_moderation_client

    async with db_session() as db:
        # find flagged scans with AT URIs that haven't been resolved
        result = await db.execute(
            select(CopyrightScan, Track.atproto_record_uri)
            .join(Track, CopyrightScan.track_id == Track.id)
            .where(
                CopyrightScan.is_flagged == True,  # noqa: E712
                Track.atproto_record_uri.isnot(None),
            )
        )
        rows = result.all()

        if not rows:
            logfire.debug("sync_copyright_resolutions: no flagged scans to check")
            return

        # batch check with labeler
        scan_by_uri: dict[str, CopyrightScan] = {}
        for scan, uri in rows:
            if uri:
                scan_by_uri[uri] = scan

        if not scan_by_uri:
            return

        client = get_moderation_client()
        active_uris = await client.get_active_labels(list(scan_by_uri.keys()))

        # find scans that are no longer active (label was negated)
        resolved_count = 0
        for uri, scan in scan_by_uri.items():
            if uri not in active_uris:
                # label was negated - track is no longer flagged
                scan.is_flagged = False
                resolved_count += 1

        if resolved_count > 0:
            await db.commit()
            logfire.info(
                "sync_copyright_resolutions: resolved {count} scans",
                count=resolved_count,
            )
        else:
            logfire.debug(
                "sync_copyright_resolutions: checked {count} scans, none resolved",
                count=len(scan_by_uri),
            )


async def schedule_copyright_resolution_sync() -> None:
    """schedule a copyright resolution sync via docket."""
    docket = get_docket()
    await docket.add(sync_copyright_resolutions)()
    logfire.info("scheduled copyright resolution sync")
