"""moderation service client for copyright scanning."""

import logging
from typing import Any

import httpx
import logfire

from backend.config import settings
from backend.models import CopyrightScan
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


async def scan_track_for_copyright(track_id: int, audio_url: str) -> None:
    """scan a track for potential copyright matches.

    this runs as a fire-and-forget background task. failures are logged
    but do not affect the upload flow.

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
            logger.error(
                "copyright scan failed for track %d: %s",
                track_id,
                e,
                exc_info=True,
            )
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
    async with db_session() as db:
        scan = CopyrightScan(
            track_id=track_id,
            is_flagged=result.get("is_flagged", False),
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
