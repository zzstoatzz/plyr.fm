"""moderation service integration for copyright scanning."""

import logging

import logfire
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from backend._internal.clients.moderation import ScanResult, get_moderation_client
from backend._internal.notifications import notification_service
from backend.config import settings
from backend.models import CopyrightScan, Track
from backend.utilities.copyright_evidence import (
    SongEvidence,
    is_self_match,
    song_evidence,
)
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


def _format_span(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def describe_evidence(evidence: list[SongEvidence], limit: int = 3) -> list[str]:
    """one line per recording found: who, what, and where in the upload."""
    return [
        f"{e.artist} - {e.title} "
        f"({_format_span(e.start_seconds)}-{_format_span(e.end_seconds)})"
        for e in evidence[:limit]
    ]


async def scan_track_for_copyright(
    track_id: int, audio_url: str, *, final_attempt: bool = True
) -> None:
    """scan a track for potential copyright matches.

    a scan that fails is raised so the task retries; only the final attempt
    records the failure, and a failed scan is never recorded as clear.

    args:
        track_id: database ID of the track to scan
        audio_url: public URL of the audio file (R2)
        final_attempt: whether a failure here should be recorded, not raised
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
            result = await get_moderation_client().scan(audio_url)
        except Exception as e:
            if not final_attempt:
                raise
            await _store_scan_failure(track_id, str(e))
            return
        await _store_scan_result(track_id, result)


async def _store_scan_result(track_id: int, result: ScanResult) -> None:
    """store a scan and, when it shows someone else's recording, open a review."""
    evidence = song_evidence(result.matches)

    async with db_session() as db:
        track = await db.scalar(
            select(Track).options(joinedload(Track.artist)).where(Track.id == track_id)
        )
        if track is None:
            logfire.info("copyright scan for a deleted track", track_id=track_id)
            return

        handle = track.artist.handle if track.artist else ""
        display_name = (track.artist.display_name or "") if track.artist else ""
        others = [
            e for e in evidence if not is_self_match(e.artist, handle, display_name)
        ]

        scan = CopyrightScan(
            track_id=track_id,
            is_flagged=bool(others),
            highest_score=result.highest_score,
            matches=result.matches,
            raw_response={
                **result.raw_response,
                "evidence": [e.as_dict() for e in evidence],
            },
        )
        db.add(scan)
        await db.commit()

        logfire.info(
            "copyright scan stored",
            track_id=track_id,
            is_flagged=scan.is_flagged,
            match_count=len(scan.matches),
            recordings_found=len(evidence),
            own_recordings=len(evidence) - len(others),
        )

        if not others:
            return

        if track.atproto_record_uri:
            await get_moderation_client().record_event(
                subject_uri=track.atproto_record_uri,
                subject_track_id=track_id,
                action="flagged_by_scan",
                actor="service:copyright-scan",
                reason="fingerprint_match",
                notes="; ".join(describe_evidence(others)),
            )

        # notify admin only — never DM the artist
        if track.artist:
            await notification_service.send_copyright_flag_notification(
                track_id=track_id,
                track_title=track.title,
                artist_handle=handle,
                recordings=describe_evidence(others),
                recordings_found=len(others),
            )


async def _store_scan_failure(track_id: int, error: str) -> None:
    """record that a track could not be scanned."""
    async with db_session() as db:
        if await db.scalar(select(Track.id).where(Track.id == track_id)) is None:
            return
        db.add(
            CopyrightScan(
                track_id=track_id,
                is_flagged=False,
                highest_score=0,
                matches=[],
                raw_response={"error": error, "status": "scan_failed"},
            )
        )
        await db.commit()

    logfire.error("copyright scan failed", track_id=track_id, error=error)


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
