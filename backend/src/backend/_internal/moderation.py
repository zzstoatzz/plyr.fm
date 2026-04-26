"""moderation service integration for copyright scanning."""

import logging
from collections import Counter
from typing import Any

import logfire
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from backend._internal.clients.moderation import get_moderation_client
from backend._internal.notifications import notification_service
from backend.config import settings
from backend.models import CopyrightScan, Track
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)

_SELF_MATCH_MIN_SLUG_LEN = 4


def _slugify_artist(name: str) -> str:
    """lowercase, alphanumeric-only — for fuzzy artist-name comparison."""
    return "".join(c for c in name.lower() if c.isalnum())


def _is_self_match(
    match_artist: str, uploader_handle: str, uploader_display: str
) -> bool:
    """detect when a copyright match's artist is the uploader themselves.

    AuDD frequently identifies an artist's own catalog uploads as
    "violations" of their own published works elsewhere (e.g. dominant
    match "Floby IV" on a track uploaded by handle "flo.by"). this is
    a false positive — flagging it spams admin DMs and shows a red
    badge to the artist on their own portal.

    we compare slugified forms (lowercase, alphanumeric only) of the
    match artist against the uploader's handle and display name. a
    bidirectional substring check catches stage-name variants in
    either direction (e.g. "flo.by" → "floby" is contained in
    "Floby IV" → "flobyiv"). minimum length avoids accidental
    matches on very short slugs.
    """
    m = _slugify_artist(match_artist)
    if len(m) < _SELF_MATCH_MIN_SLUG_LEN:
        return False
    for candidate in (uploader_handle, uploader_display):
        if not candidate:
            continue
        c = _slugify_artist(candidate)
        if len(c) >= _SELF_MATCH_MIN_SLUG_LEN and (c in m or m in c):
            return True
    return False


def _dominant_match_artist(matches: list[dict[str, Any]]) -> str | None:
    """return the most frequent artist in scan matches, or None if empty."""
    counts = Counter(
        (m.get("artist") or "").strip() for m in matches if m.get("artist")
    )
    if not counts:
        return None
    artist, _ = counts.most_common(1)[0]
    return artist or None


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
        # decide effective is_flagged BEFORE the row is written so the
        # transient flag never reaches the UI / DM path. self-matches
        # (uploader is the dominant match artist) get demoted to clear.
        is_flagged = result.is_flagged
        suppressed_self_match: str | None = None

        if is_flagged:
            track = await db.scalar(
                select(Track)
                .options(joinedload(Track.artist))
                .where(Track.id == track_id)
            )
            dominant = _dominant_match_artist(result.matches)
            if (
                track
                and track.artist
                and dominant
                and _is_self_match(
                    dominant, track.artist.handle, track.artist.display_name or ""
                )
            ):
                is_flagged = False
                suppressed_self_match = dominant
        else:
            track = None

        scan = CopyrightScan(
            track_id=track_id,
            is_flagged=is_flagged,
            highest_score=result.highest_score,
            matches=result.matches,
            raw_response=result.raw_response,
        )
        db.add(scan)
        await db.commit()

        if suppressed_self_match:
            logfire.info(
                "copyright self-match suppressed",
                track_id=track_id,
                dominant_artist=suppressed_self_match,
                uploader_handle=track.artist.handle if track and track.artist else None,
            )
            return

        logfire.info(
            "copyright scan stored",
            track_id=track_id,
            is_flagged=scan.is_flagged,
            highest_score=scan.highest_score,
            match_count=len(scan.matches),
        )

        # notify admin only — never DM the artist
        if is_flagged and track and track.artist:
            await notification_service.send_copyright_flag_notification(
                track_id=track_id,
                track_title=track.title,
                artist_handle=track.artist.handle,
                matches=scan.matches,
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
