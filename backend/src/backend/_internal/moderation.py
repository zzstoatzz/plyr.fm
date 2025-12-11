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

# redis cache key prefix and TTL for active copyright labels
_LABEL_CACHE_PREFIX = "plyr:copyright-label:"
_LABEL_CACHE_TTL = 300  # 5 minutes, matches queue cache


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
                    track_id=track_id,
                    track_title=track.title,
                    artist_handle=track.artist.handle if track.artist else None,
                    artist_did=track.artist_did,
                    highest_score=scan.highest_score,
                    matches=scan.matches,
                )


async def _emit_copyright_label(
    uri: str,
    cid: str | None,
    track_id: int | None = None,
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
        track_id: database ID of the track (for admin UI links)
        track_title: title of the track (for admin UI context)
        artist_handle: handle of the artist (for admin UI context)
        artist_did: DID of the artist (for admin UI context)
        highest_score: highest match score (for admin UI context)
        matches: list of copyright matches (for admin UI context)
    """
    try:
        # build context for admin UI display
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

            # invalidate cache since label status changed
            await invalidate_label_cache(uri)

            logfire.info(
                "copyright label emitted",
                uri=uri,
                cid=cid,
            )
    except Exception as e:
        logger.warning("failed to emit copyright label for %s: %s", uri, e)


async def get_active_copyright_labels(uris: list[str]) -> set[str]:
    """check which URIs have active (non-negated) copyright-violation labels.

    uses redis cache (shared across instances) to avoid repeated calls
    to the moderation service. only URIs not in cache are fetched.

    args:
        uris: list of AT URIs to check

    returns:
        set of URIs that are still actively flagged

    note:
        fails closed (returns all URIs as active) if moderation service is unreachable
        to avoid accidentally hiding real violations.
    """
    if not uris:
        return set()

    if not settings.moderation.enabled:
        logger.debug("moderation disabled, treating all as active")
        return set(uris)

    if not settings.moderation.auth_token:
        logger.warning("MODERATION_AUTH_TOKEN not set, treating all as active")
        return set(uris)

    # check redis cache first - partition into cached vs uncached
    active_from_cache: set[str] = set()
    uris_to_fetch: list[str] = []

    try:
        from backend.utilities.redis import get_async_redis_client

        redis = get_async_redis_client()
        cache_keys = [f"{_LABEL_CACHE_PREFIX}{uri}" for uri in uris]
        cached_values = await redis.mget(cache_keys)

        for uri, cached_value in zip(uris, cached_values, strict=True):
            if cached_value is not None:
                if cached_value == "1":
                    active_from_cache.add(uri)
                # else: cached as "0" (not active), skip
            else:
                uris_to_fetch.append(uri)
    except Exception as e:
        # redis unavailable - fall through to fetch all
        logger.warning("redis cache unavailable: %s", e)
        uris_to_fetch = list(uris)

    # if everything was cached, return early
    if not uris_to_fetch:
        logfire.debug(
            "checked active copyright labels (all cached)",
            total_uris=len(uris),
            active_count=len(active_from_cache),
        )
        return active_from_cache

    # fetch uncached URIs from moderation service
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(settings.moderation.timeout_seconds)
        ) as client:
            response = await client.post(
                f"{settings.moderation.labeler_url}/admin/active-labels",
                json={"uris": uris_to_fetch},
                headers={"X-Moderation-Key": settings.moderation.auth_token},
            )
            response.raise_for_status()
            data = response.json()
            active_from_service = set(data.get("active_uris", []))

            # update redis cache with results
            try:
                from backend.utilities.redis import get_async_redis_client

                redis = get_async_redis_client()
                async with redis.pipeline() as pipe:
                    for uri in uris_to_fetch:
                        cache_key = f"{_LABEL_CACHE_PREFIX}{uri}"
                        value = "1" if uri in active_from_service else "0"
                        await pipe.set(cache_key, value, ex=_LABEL_CACHE_TTL)
                    await pipe.execute()
            except Exception as e:
                # cache update failed - not critical, just log
                logger.warning("failed to update redis cache: %s", e)

            logfire.info(
                "checked active copyright labels",
                total_uris=len(uris),
                cached_count=len(uris) - len(uris_to_fetch),
                fetched_count=len(uris_to_fetch),
                active_count=len(active_from_cache) + len(active_from_service),
            )
            return active_from_cache | active_from_service

    except Exception as e:
        # fail closed: if we can't confirm resolution, treat as active
        # don't cache failures - we want to retry next time
        logger.warning("failed to check active labels, treating all as active: %s", e)
        return set(uris)


async def invalidate_label_cache(uri: str) -> None:
    """invalidate cache entry for a URI when its label status changes.

    call this when emitting or negating labels to ensure fresh data.
    """
    try:
        from backend.utilities.redis import get_async_redis_client

        redis = get_async_redis_client()
        await redis.delete(f"{_LABEL_CACHE_PREFIX}{uri}")
    except Exception as e:
        logger.warning("failed to invalidate label cache for %s: %s", uri, e)


async def clear_label_cache() -> None:
    """clear all label cache entries. primarily for testing."""
    try:
        from backend.utilities.redis import get_async_redis_client

        redis = get_async_redis_client()
        # scan and delete all keys with our prefix
        cursor = 0
        while True:
            cursor, keys = await redis.scan(
                cursor, match=f"{_LABEL_CACHE_PREFIX}*", count=100
            )
            if keys:
                await redis.delete(*keys)
            if cursor == 0:
                break
    except Exception as e:
        logger.warning("failed to clear label cache: %s", e)


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
