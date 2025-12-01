"""moderation service client for copyright scanning."""

import logging
from typing import Any

import httpx
import logfire
from sqlalchemy import select

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
            result = await _call_moderation_service(audio_url)
            await _store_scan_result(track_id, result)
        except Exception as e:
            logger.warning(
                "copyright scan failed for track %d: %s - storing as clear",
                track_id,
                e,
            )
            # store as "clear" with error info so track doesn't stay unscanned
            # this handles cases like: audio too short, unreadable format, etc.
            await _store_scan_error(track_id, str(e))
            # don't re-raise - this is fire-and-forget


async def _call_moderation_service(audio_url: str) -> dict[str, Any]:
    """call the moderation service /scan endpoint.

    args:
        audio_url: public URL of the audio file

    returns:
        scan result from moderation service

    raises:
        httpx.HTTPStatusError: on non-2xx response
        httpx.TimeoutException: on timeout
    """
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(settings.moderation.timeout_seconds)
    ) as client:
        response = await client.post(
            f"{settings.moderation.service_url}/scan",
            json={"audio_url": audio_url},
            headers={"X-Moderation-Key": settings.moderation.auth_token},
        )
        response.raise_for_status()
        return response.json()


async def _store_scan_result(track_id: int, result: dict[str, Any]) -> None:
    """store scan result in the database.

    args:
        track_id: database ID of the track
        result: scan result from moderation service
    """
    from sqlalchemy.orm import joinedload

    async with db_session() as db:
        is_flagged = result.get("is_flagged", False)

        scan = CopyrightScan(
            track_id=track_id,
            is_flagged=is_flagged,
            highest_score=result.get("highest_score", 0),
            matches=result.get("matches", []),
            raw_response=result.get("raw_response", {}),
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

        # emit ATProto label if flagged
        if is_flagged:
            track = await db.scalar(
                select(Track)
                .options(joinedload(Track.artist))
                .where(Track.id == track_id)
            )
            if track and track.atproto_record_uri:
                await _emit_copyright_label(
                    uri=track.atproto_record_uri,
                    cid=track.atproto_record_cid,
                    track_title=track.title,
                    artist_handle=track.artist.handle if track.artist else None,
                    artist_did=track.artist_did,
                    highest_score=scan.highest_score,
                    matches=scan.matches,
                )


async def _emit_copyright_label(
    uri: str,
    cid: str | None,
    track_title: str | None = None,
    artist_handle: str | None = None,
    artist_did: str | None = None,
    highest_score: float | None = None,
    matches: list[dict[str, Any]] | None = None,
) -> None:
    """emit a copyright-violation label to the ATProto labeler service.

    this is fire-and-forget - failures are logged but don't affect the scan result.

    args:
        uri: AT URI of the track record
        cid: optional CID of the record
        track_title: title of the track (for admin UI context)
        artist_handle: handle of the artist (for admin UI context)
        artist_did: DID of the artist (for admin UI context)
        highest_score: highest match score (for admin UI context)
        matches: list of copyright matches (for admin UI context)
    """
    try:
        # build context for admin UI display
        context: dict[str, Any] | None = None
        if track_title or artist_handle or matches:
            context = {
                "track_title": track_title,
                "artist_handle": artist_handle,
                "artist_did": artist_did,
                "highest_score": highest_score,
                "matches": matches,
            }

        payload: dict[str, Any] = {
            "uri": uri,
            "val": "copyright-violation",
            "cid": cid,
        }
        if context:
            payload["context"] = context

        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            response = await client.post(
                f"{settings.moderation.labeler_url}/emit-label",
                json=payload,
                headers={"X-Moderation-Key": settings.moderation.auth_token},
            )
            response.raise_for_status()

            logfire.info(
                "copyright label emitted",
                uri=uri,
                cid=cid,
            )
    except Exception as e:
        logger.warning("failed to emit copyright label for %s: %s", uri, e)


async def _store_scan_error(track_id: int, error: str) -> None:
    """store a scan error as a clear result.

    when the moderation service can't process a file (too short, bad format, etc.),
    we still want to record that we tried so the track isn't stuck in limbo.

    args:
        track_id: database ID of the track
        error: error message from the failed scan
    """
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
