"""moderation service integration for copyright scanning."""

import logging
from datetime import UTC, datetime
from typing import Any

import logfire
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from backend._internal.moderation_client import get_moderation_client
from backend._internal.notifications import notification_service
from backend.config import settings
from backend.models import CopyrightScan, Track
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


async def scan_track_for_copyright(track_id: int, audio_url: str) -> None:
    """scan a track for potential copyright matches.

    this runs as a fire-and-forget background task. failures are logged
    but do not affect the upload flow.

    if the scan fails (e.g., audio too short, unreadable format), we store
    a "clear" result with the error info so the track isn't stuck unscanned.

    args:
        track_id: database ID of the track to scan
        audio_url: public URL of the audio file (R2)
    """
    if not settings.moderation.enabled:
        logger.debug("moderation disabled, skipping copyright scan")
        return

    if not settings.moderation.auth_token:
        logger.warning("MODERATION_AUTH_TOKEN not set, skipping copyright scan")
        return

    with logfire.span(
        "copyright scan",
        track_id=track_id,
        audio_url=audio_url,
    ):
        try:
            client = get_moderation_client()
            result = await client.scan(audio_url)
            await _store_scan_result(track_id, result)
        except Exception as e:
            logger.warning(
                "copyright scan failed for track %d: %s - storing as clear",
                track_id,
                e,
            )
            await _store_scan_error(track_id, str(e))


async def _store_scan_result(track_id: int, result: Any) -> None:
    """store scan result in the database.

    args:
        track_id: database ID of the track
        result: ScanResult from moderation client
    """
    async with db_session() as db:
        scan = CopyrightScan(
            track_id=track_id,
            is_flagged=result.is_flagged,
            highest_score=result.highest_score,
            matches=result.matches,
            raw_response=result.raw_response,
        )
        db.add(scan)
        await db.commit()

        logfire.info(
            "copyright scan stored",
            track_id=track_id,
            is_flagged=scan.is_flagged,
            highest_score=scan.highest_score,
            match_count=len(scan.matches),
        )

        # send notification if flagged (see #702)
        if result.is_flagged:
            track = await db.scalar(
                select(Track)
                .options(joinedload(Track.artist))
                .where(Track.id == track_id)
            )
            if track and track.artist:
                notified = await notification_service.send_copyright_notification(
                    track_id=track_id,
                    track_title=track.title,
                    artist_did=track.artist_did,
                    artist_handle=track.artist.handle,
                    highest_score=scan.highest_score,
                    matches=scan.matches,
                )
                if notified:
                    scan.notified_at = datetime.now(UTC)
                    await db.commit()


async def _emit_copyright_label(
    uri: str,
    cid: str | None,
    track_id: int | None = None,
    track_title: str | None = None,
    artist_handle: str | None = None,
    artist_did: str | None = None,
    highest_score: int | None = None,
    matches: list[dict[str, Any]] | None = None,
) -> None:
    """emit a copyright-violation label to the ATProto labeler service."""
    context: dict[str, Any] | None = None
    if track_id or track_title or artist_handle or matches:
        context = {
            "track_id": track_id,
            "track_title": track_title,
            "artist_handle": artist_handle,
            "artist_did": artist_did,
            "highest_score": highest_score,
            "matches": matches,
        }

    client = get_moderation_client()
    await client.emit_label(uri=uri, cid=cid, context=context)


async def _store_scan_error(track_id: int, error: str) -> None:
    """store a scan error as a clear result."""
    async with db_session() as db:
        scan = CopyrightScan(
            track_id=track_id,
            is_flagged=False,
            highest_score=0,
            matches=[],
            raw_response={"error": error, "status": "scan_failed"},
        )
        db.add(scan)
        await db.commit()

        logfire.info(
            "copyright scan error stored as clear",
            track_id=track_id,
            error=error,
        )


# re-export for backwards compatibility
async def get_active_copyright_labels(uris: list[str]) -> set[str]:
    """check which URIs have active copyright-violation labels.

    this is a convenience wrapper around the moderation client.
    """
    if not settings.moderation.enabled:
        logger.debug("moderation disabled, treating all as active")
        return set(uris)

    if not settings.moderation.auth_token:
        logger.warning("MODERATION_AUTH_TOKEN not set, treating all as active")
        return set(uris)

    client = get_moderation_client()
    return await client.get_active_labels(uris)


async def invalidate_label_cache(uri: str) -> None:
    """invalidate cache entry for a URI."""
    client = get_moderation_client()
    await client.invalidate_cache(uri)


async def clear_label_cache() -> None:
    """clear all label cache entries."""
    client = get_moderation_client()
    await client.clear_cache()
