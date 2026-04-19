"""shared post-creation hooks for tracks.

this is the SINGLE place to add new post-creation behavior.
both the API upload path and Jetstream ingest call run_post_track_create_hooks().
"""

import logging

import logfire
from redis.exceptions import RedisError
from sqlalchemy import delete, select
from sqlalchemy.orm import joinedload

from backend._internal.atproto.client import pds_blob_url
from backend._internal.tasks.copyright import schedule_copyright_scan
from backend._internal.tasks.ml import (
    schedule_embedding_generation,
    schedule_genre_classification,
)
from backend.config import settings
from backend.models import Artist, CopyrightScan, Track
from backend.utilities.database import db_session
from backend.utilities.redis import get_async_redis_client

logger = logging.getLogger(__name__)

_DISCOVERY_CACHE_KEY = "plyr:tracks:discovery"


async def invalidate_tracks_discovery_cache() -> None:
    """delete the anonymous discovery feed cache key."""
    try:
        redis = get_async_redis_client()
        await redis.delete(_DISCOVERY_CACHE_KEY)
    except (RuntimeError, RedisError):
        logger.debug("failed to invalidate discovery cache")


async def resolve_audio_url(track_id: int) -> str | None:
    """resolve a fetchable audio URL for a track (R2 or PDS blob)."""
    async with db_session() as db:
        result = await db.execute(
            select(
                Track.r2_url,
                Track.audio_storage,
                Track.pds_blob_cid,
                Track.artist_did,
            )
            .where(Track.id == track_id)
            .limit(1)
        )
        row = result.first()
        if not row:
            return None

        r2_url, audio_storage, pds_blob_cid, artist_did = row

        if r2_url:
            return r2_url

        if audio_storage == "pds" and pds_blob_cid:
            artist_result = await db.execute(
                select(Artist.pds_url).where(Artist.did == artist_did).limit(1)
            )
            artist_pds_url = artist_result.scalar_one_or_none()
            if artist_pds_url:
                return pds_blob_url(artist_pds_url, artist_did, pds_blob_cid)

        return None


async def run_post_track_create_hooks(
    track_id: int,
    *,
    audio_url: str | None = None,
    skip_notification: bool = False,
    skip_copyright: bool = False,
) -> None:
    """post-creation side effects for tracks — shared between upload and ingest.

    this is the SINGLE place to add new post-creation behavior.
    both the API upload path and Jetstream ingest call this function.
    """
    if audio_url is None:
        audio_url = await resolve_audio_url(track_id)

    # 1. notification
    if skip_notification:
        await _mark_notification_sent(track_id)
    else:
        await _send_track_notification(track_id)

    # 2. copyright scan
    if audio_url and not skip_copyright:
        await schedule_copyright_scan(track_id, audio_url)

    # 3. CLAP embedding
    if audio_url and settings.modal.enabled and settings.turbopuffer.enabled:
        await schedule_embedding_generation(track_id, audio_url)

    # 4. genre classification
    if audio_url and settings.replicate.enabled:
        await schedule_genre_classification(track_id, audio_url)

    # 5. discovery cache invalidation
    await invalidate_tracks_discovery_cache()

    logfire.info(
        "post-create hooks completed",
        track_id=track_id,
        has_audio_url=audio_url is not None,
    )


async def run_post_track_audio_replace_hooks(
    track_id: int,
    *,
    audio_url: str | None = None,
) -> None:
    """post-replace side effects for tracks — fired when audio bytes change.

    differences from `run_post_track_create_hooks`:
    - never sends a creation notification (followers were notified at upload time)
    - invalidates stale CopyrightScan rows before re-scheduling a fresh scan
    - re-runs CLAP embedding (turbopuffer upsert overwrites by track_id)
    - re-runs genre classification only when the upload originally opted in
      via `extra.auto_tag` (we don't want to clobber manual tags)

    note: a labeler label attached to the (stable) track URI from the OLD audio
    is NOT auto-dismissed here. that's a moderation decision — left for manual
    review via the admin tooling.
    """
    if audio_url is None:
        audio_url = await resolve_audio_url(track_id)

    # 1. invalidate stale copyright scan rows so the new scan replaces them
    async with db_session() as db:
        await db.execute(
            delete(CopyrightScan).where(CopyrightScan.track_id == track_id)
        )
        await db.commit()

    # 2. re-trigger copyright scan against the new audio bytes
    if audio_url:
        await schedule_copyright_scan(track_id, audio_url)

    # 3. re-trigger CLAP embedding (turbopuffer upsert overwrites)
    if audio_url and settings.modal.enabled and settings.turbopuffer.enabled:
        await schedule_embedding_generation(track_id, audio_url)

    # 4. re-trigger genre classification only if the original upload opted in.
    # the classify_genres task tracks `extra.genre_predictions_file_id` so it
    # already knows when a re-classification is needed, but we only want auto-tag
    # to fire again if the user originally requested it.
    if audio_url and settings.replicate.enabled:
        async with db_session() as db:
            track = await db.get(Track, track_id)
            should_reclassify = bool(track and track.extra.get("auto_tag"))
        if should_reclassify:
            await schedule_genre_classification(track_id, audio_url)

    # 5. discovery cache invalidation (in case "for-you" used stale embedding)
    await invalidate_tracks_discovery_cache()

    logfire.info(
        "post-replace hooks completed",
        track_id=track_id,
        has_audio_url=audio_url is not None,
    )


async def _mark_notification_sent(track_id: int) -> None:
    """mark notification as sent without actually sending — prevents Jetstream from firing it later."""
    try:
        async with db_session() as db:
            track = await db.get(Track, track_id)
            if track and not track.notification_sent:
                track.notification_sent = True
                await db.commit()
    except Exception as e:
        logger.warning(f"failed to mark notification sent for track {track_id}: {e}")


async def _send_track_notification(track_id: int) -> None:
    """send notification for new track, if not already sent."""
    from backend._internal.notifications import notification_service

    try:
        async with db_session() as db:
            track = await db.scalar(
                select(Track)
                .options(joinedload(Track.artist))
                .where(Track.id == track_id)
            )
            if not track:
                logger.warning(f"track {track_id} not found for notification")
                return
            if track.notification_sent:
                return
            await notification_service.send_track_notification(track)
            track.notification_sent = True
            await db.commit()
    except Exception as e:
        logger.warning(f"failed to send notification for track {track_id}: {e}")
