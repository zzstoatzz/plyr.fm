"""background tasks for saving audio blobs to a user's PDS."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterable

import logfire
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend._internal.atproto import PayloadTooLargeError, upload_blob
from backend._internal.atproto.records import build_track_record, update_record
from backend._internal.audio import AudioFormat
from backend._internal.auth import get_session
from backend._internal.background import get_docket
from backend._internal.jobs import job_service
from backend.config import settings
from backend.models import Track
from backend.models.job import JobStatus
from backend.storage import storage
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


async def save_tracks_to_pds(
    save_id: str,
    session_id: str,
    track_ids: list[int],
) -> None:
    """save existing track audio to the user's PDS in the background.

    args:
        save_id: job ID for tracking progress
        session_id: OAuth session ID for authentication
        track_ids: list of track IDs to save
    """
    auth_session = await get_session(session_id)
    if not auth_session:
        await job_service.update_progress(
            save_id,
            JobStatus.FAILED,
            "save failed",
            error="session not found",
        )
        return

    total_count = len(track_ids)
    if total_count == 0:
        await job_service.update_progress(
            save_id,
            JobStatus.COMPLETED,
            "no tracks to save",
            progress_pct=100.0,
            result={
                "total_count": 0,
                "processed_count": 0,
                "saved_count": 0,
                "skipped_count": 0,
                "failed_count": 0,
            },
        )
        return

    await job_service.update_progress(
        save_id,
        JobStatus.PROCESSING,
        "starting save...",
        progress_pct=0.0,
        phase="init",
        result={
            "total_count": total_count,
            "processed_count": 0,
            "saved_count": 0,
            "skipped_count": 0,
            "failed_count": 0,
        },
    )

    saved_count = 0
    skipped_count = 0
    failed_count = 0
    processed_count = 0
    last_processed_track_id: int | None = None
    last_status: str | None = None
    progress_lock = asyncio.Lock()

    concurrency = max(1, min(settings.docket.worker_concurrency, 3))
    semaphore = asyncio.Semaphore(concurrency)

    async def update_progress(message: str) -> None:
        progress_pct = (processed_count / total_count) * 100.0
        await job_service.update_progress(
            save_id,
            JobStatus.PROCESSING,
            message,
            progress_pct=progress_pct,
            phase="save",
            result={
                "processed_count": processed_count,
                "saved_count": saved_count,
                "skipped_count": skipped_count,
                "failed_count": failed_count,
                "last_processed_track_id": last_processed_track_id,
                "last_status": last_status,
            },
        )

    async def save_one(track_id: int) -> None:
        nonlocal saved_count, skipped_count, failed_count, processed_count
        nonlocal last_processed_track_id, last_status

        async with semaphore:
            track_data: dict | None = None
            one_status = "skipped"
            try:
                async with db_session() as db:
                    result = await db.execute(
                        select(Track)
                        .options(selectinload(Track.artist))
                        .where(Track.id == track_id)
                    )
                    track = result.scalar_one_or_none()

                    if not track:
                        skipped_count += 1
                        return

                    if track.artist_did != auth_session.did:
                        skipped_count += 1
                        return

                    if track.support_gate is not None:
                        skipped_count += 1
                        return

                    if track.pds_blob_cid:
                        skipped_count += 1
                        return

                    if not track.file_id or not track.file_type:
                        failed_count += 1
                        return

                    track_data = {
                        "id": track.id,
                        "title": track.title,
                        "file_id": track.file_id,
                        "file_type": track.file_type,
                        "r2_url": track.r2_url,
                        "album": track.album,
                        "duration": track.duration,
                        "features": track.features,
                        "image_id": track.image_id,
                        "image_url": track.image_url,
                        "support_gate": track.support_gate,
                        "self_labels": list(track.self_labels or []),
                        "artist_name": track.artist.display_name or track.artist.handle,
                        "created_at": track.created_at,
                        "atproto_record_uri": track.atproto_record_uri,
                    }

                if not track_data:
                    skipped_count += 1
                    return

                audio_format = AudioFormat.from_extension(track_data["file_type"])
                if not audio_format:
                    failed_count += 1
                    return

                audio_url = track_data["r2_url"]
                if not audio_url:
                    audio_url = await storage.get_url(
                        track_data["file_id"],
                        file_type="audio",
                        extension=track_data["file_type"],
                    )
                if not audio_url:
                    failed_count += 1
                    return

                content_length = await storage.head_file(
                    track_data["file_id"],
                    track_data["file_type"],
                )
                if content_length is None:
                    failed_count += 1
                    return

                track_file_id = track_data["file_id"]
                track_file_type = track_data["file_type"]

                def body_factory() -> AsyncIterable[bytes]:
                    return storage.stream_file_data(track_file_id, track_file_type)

                blob_ref = await upload_blob(
                    auth_session,
                    body_factory=body_factory,
                    content_length=content_length,
                    content_type=audio_format.media_type,
                )
                blob_cid = blob_ref.get("ref", {}).get("$link")
                blob_size = blob_ref.get("size")

                new_record_cid: str | None = None
                if track_data["atproto_record_uri"]:
                    image_url = track_data["image_url"]
                    if not image_url and track_data["image_id"]:
                        image_url = await storage.get_url(
                            track_data["image_id"], file_type="image"
                        )

                    track_record = await build_track_record(
                        title=track_data["title"],
                        artist=track_data["artist_name"],
                        audio_url=audio_url,
                        file_type=track_data["file_type"],
                        album=track_data["album"],
                        duration=track_data["duration"],
                        features=track_data["features"]
                        if track_data["features"]
                        else None,
                        image_url=image_url,
                        support_gate=track_data["support_gate"],
                        audio_blob=blob_ref,
                        self_labels=track_data["self_labels"],
                    )
                    track_record["createdAt"] = track_data["created_at"].isoformat()

                    _, new_record_cid = await update_record(
                        auth_session, track_data["atproto_record_uri"], track_record
                    )

                async with db_session() as db:
                    result = await db.execute(select(Track).where(Track.id == track_id))
                    track = result.scalar_one_or_none()
                    if not track:
                        failed_count += 1
                        return

                    track.audio_storage = "both"
                    track.pds_blob_cid = blob_cid
                    track.pds_blob_size = blob_size
                    if new_record_cid:
                        track.atproto_record_cid = new_record_cid
                    await db.commit()

                saved_count += 1
                one_status = "saved"

            except PayloadTooLargeError:
                skipped_count += 1
                one_status = "skipped"
            except Exception as e:
                logger.error(
                    "pds save failed for track %s: %s",
                    track_id,
                    e,
                    exc_info=True,
                )
                failed_count += 1
                one_status = "failed"
            finally:
                async with progress_lock:
                    processed_count += 1
                    last_processed_track_id = track_id
                    last_status = one_status
                    await update_progress(f"saved {saved_count}/{total_count} tracks")

    await asyncio.gather(*(save_one(track_id) for track_id in track_ids))

    if saved_count == 0 and failed_count > 0 and skipped_count == 0:
        await job_service.update_progress(
            save_id,
            JobStatus.FAILED,
            "save failed",
            progress_pct=100.0,
            result={
                "processed_count": processed_count,
                "saved_count": saved_count,
                "skipped_count": skipped_count,
                "failed_count": failed_count,
            },
        )
        return

    summary = (
        f"save completed ({saved_count} saved, {skipped_count} skipped, {failed_count} failed)"
        if failed_count > 0 or skipped_count > 0
        else "save completed"
    )
    await job_service.update_progress(
        save_id,
        JobStatus.COMPLETED,
        summary,
        progress_pct=100.0,
        result={
            "processed_count": processed_count,
            "saved_count": saved_count,
            "skipped_count": skipped_count,
            "failed_count": failed_count,
        },
    )


async def schedule_pds_save(
    save_id: str,
    session_id: str,
    track_ids: list[int],
) -> None:
    """schedule a PDS audio save via docket."""
    docket = get_docket()
    await docket.add(save_tracks_to_pds)(save_id, session_id, track_ids)
    logfire.info("scheduled pds audio save", save_id=save_id)
