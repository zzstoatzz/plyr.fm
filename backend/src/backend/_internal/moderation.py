"""moderation service integration for copyright scanning."""

import json
import logging
from datetime import UTC, datetime
from typing import Any

import logfire
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from backend._internal.clients.moderation import get_moderation_client
from backend._internal.notifications import notification_service
from backend.config import settings
from backend.models import CopyrightScan, Track
from backend.utilities.database import db_session
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

MODERATION_STREAM_KEY = "moderation:actions"


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

        # load track for notification + event publishing
        track = await db.scalar(
            select(Track).options(joinedload(Track.artist)).where(Track.id == track_id)
        )

        # notify admin only — never DM the artist
        if result.is_flagged and track and track.artist:
            await notification_service.send_copyright_flag_notification(
                track_id=track_id,
                track_title=track.title,
                artist_handle=track.artist.handle,
                matches=scan.matches,
            )

        # publish to moderation stream for Osprey rules engine
        if track:
            await _publish_moderation_event(
                action_type="copyright_scan_completed",
                track_id=track_id,
                artist_did=track.artist.did if track.artist else None,
                track_at_uri=track.atproto_record_uri,
                scan={
                    "highest_score": result.highest_score,
                    "dominant_match_pct": result.raw_response.get(
                        "dominant_match_pct", 0
                    ),
                    "match_count": len(result.matches),
                    "dominant_match": result.raw_response.get("dominant_match"),
                    "matches": result.matches,
                },
            )


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


async def _publish_moderation_event(
    action_type: str,
    track_id: int | None = None,
    artist_did: str | None = None,
    track_at_uri: str | None = None,
    scan: dict[str, Any] | None = None,
) -> None:
    """publish a moderation event to the Redis stream for Osprey.

    events are published to the `moderation:actions` stream. the Osprey
    worker reads from this stream and evaluates rules against the event data.

    failures are logged but never block the caller — the existing moderation
    pipeline continues to work regardless of whether Osprey is running.
    """
    try:
        redis = get_async_redis_client()
        payload: dict[str, Any] = {
            "action_type": action_type,
            "timestamp": datetime.now(UTC).isoformat(),
        }
        if track_id is not None:
            payload["track_id"] = track_id
        if artist_did is not None:
            payload["artist_did"] = artist_did
        if track_at_uri is not None:
            payload["track_at_uri"] = track_at_uri
        if scan is not None:
            payload["scan"] = scan

        await redis.xadd(
            MODERATION_STREAM_KEY,
            {"payload": json.dumps(payload)},
            maxlen=10000,
            approximate=True,
        )
        logfire.debug(
            "published moderation event",
            action_type=action_type,
            track_id=track_id,
        )
    except Exception:
        logger.warning(
            "failed to publish moderation event %s for track %s",
            action_type,
            track_id,
            exc_info=True,
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
