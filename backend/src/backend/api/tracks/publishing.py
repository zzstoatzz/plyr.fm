"""Explicit per-work policy changes with protected-source preparation."""

import logging
from io import BytesIO
from typing import Annotated

from atproto_oauth.security import is_safe_url
from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from backend._internal import Session, get_session, require_auth
from backend._internal.atproto.records.fm_plyr.track import rebuild_track_pds_record
from backend._internal.background import get_docket
from backend._internal.copyright import (
    TrackRightsInput,
    clear_track_rights,
    get_user_copyright_config,
    write_track_rights,
)
from backend._internal.jobs import job_service
from backend._internal.tasks.hooks import invalidate_tracks_discovery_cache
from backend._internal.tasks.pds_mirror import _fetch_blob, cid_for_blob
from backend.api.albums.cache import invalidate_album_cache_by_id
from backend.config import settings as app_settings
from backend.models import Album, Track, UserPreferences, get_db
from backend.models.job import JobStatus, JobType
from backend.models.track_revision import TrackRevision
from backend.storage import storage
from backend.utilities.database import db_session
from backend.utilities.publishing import PublishingDefaults, resolve_publishing

from .router import router
from .uploads import _transcode_audio

logger = logging.getLogger(__name__)


class PublishingChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    settings: PublishingDefaults | None = None


class PublishingJobResponse(BaseModel):
    job_id: str


async def _prepare_protected(db: AsyncSession, track: Track, session: Session) -> None:
    was_private = track.uses_private_audio
    old = TrackRevision(
        track_id=track.id,
        file_id=track.file_id,
        file_type=track.file_type,
        original_file_id=track.original_file_id,
        original_file_type=track.original_file_type,
        audio_storage=track.audio_storage,
        audio_url=track.r2_url,
        pds_blob_cid=track.pds_blob_cid,
        pds_blob_size=track.pds_blob_size,
        duration=track.duration,
        was_gated=was_private,
    )
    original_id = track.original_file_id or track.file_id
    original_type = track.original_file_type or track.file_type
    needs_rendition = (
        track.original_file_id is None or track.original_file_id == track.file_id
    )
    if not was_private:
        if track.audio_storage == "pds":
            pds = track.artist.pds_url
            if not pds or not track.pds_blob_cid or not is_safe_url(pds):
                raise ValueError("no verified public source is available")
            data = await _fetch_blob(pds, track.artist_did, track.pds_blob_cid)
            if data is None or cid_for_blob(data) != track.pds_blob_cid:
                raise ValueError("could not verify the PDS audio")
            playback_id = await storage.save_gated(
                BytesIO(data), f"source.{track.file_type}"
            )
            if track.original_file_id:
                await storage.copy_audio_to_private(original_id, original_type)
            else:
                original_id = playback_id
            track.file_id = playback_id
        else:
            await storage.copy_audio_to_private(original_id, original_type)
            if track.file_id != original_id:
                await storage.copy_audio_to_private(track.file_id, track.file_type)
    if needs_rendition:
        job_id = await job_service.create_job(
            JobType.OPTIMIZE, session.did, "preparing protected playback"
        )
        rendition = await _transcode_audio(
            job_id,
            original_id,
            f"source.{original_type}",
            original_type,
            target_format="mp3",
            gated=True,
            timeout_seconds=app_settings.transcoder.optimize_timeout_seconds,
        )
        if rendition is None or rendition.transcoded_file_id == original_id:
            await job_service.update_progress(
                job_id, JobStatus.FAILED, "could not prepare playback"
            )
            raise ValueError("could not prepare a separate playback rendition")
        track.file_id = rendition.transcoded_file_id
        track.file_type = "mp3"
        await job_service.update_progress(
            job_id, JobStatus.COMPLETED, "playback prepared"
        )
    track.original_file_id = original_id
    track.original_file_type = original_type
    track.audio_storage = "r2_private"
    track.r2_url = None
    track.pds_blob_cid = None
    track.pds_blob_size = None
    if not was_private or needs_rendition:
        db.add(old)


async def apply_publishing(
    track_id: int, settings: PublishingDefaults, origin: str, session: Session
) -> None:
    async with db_session() as db:
        track = (
            await db.execute(
                select(Track)
                .where(Track.id == track_id)
                .options(selectinload(Track.artist))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if track is None or track.artist_did != session.did:
            raise ValueError("track not found")
        if (
            track.is_private
            or settings.access.listening == "space"
            or settings.access.visibility == "private"
        ):
            if track.publishing == settings:
                track.policy_origin = origin
                await db.commit()
                return
            raise ValueError("changing Space boundaries requires a separate migration")
        if settings.attach_rights and not await get_user_copyright_config(session.did):
            raise ValueError("configure rights information in Portal first")
        if settings.access.requires_protected_audio:
            await _prepare_protected(db, track, session)
        track.visibility = settings.access.visibility
        track.support_gate = (
            {
                "type": "any"
                if settings.access.listening == "supporters"
                else settings.access.listening
            }
            if settings.access.listening != "public"
            else None
        )
        track.download_policy = settings.access.downloads
        track.policy_origin = origin
        try:
            if track.atproto_record_uri:
                await rebuild_track_pds_record(track, session)
            await db.commit()
        except Exception:
            await db.rollback()
            await db.refresh(track)
            if track.atproto_record_uri:
                try:
                    await rebuild_track_pds_record(track, session)
                    await db.commit()
                except Exception:
                    logger.exception(
                        "could not restore PDS record for track %s", track_id
                    )
            raise
        try:
            has_rights = bool(track.copyright_song_uri or track.copyright_recording_uri)
            if settings.attach_rights and not has_rights:
                await write_track_rights(session, track, TrackRightsInput())
            elif not settings.attach_rights and has_rights:
                await clear_track_rights(session, track)
        finally:
            if track.album_id:
                await invalidate_album_cache_by_id(db, track.album_id)
            await invalidate_tracks_discovery_cache()


async def run_publishing_change(
    job_id: str, session_id: str, track_ids: list[int], settings: dict, origin: str
) -> None:
    session = await get_session(session_id)
    if session is None:
        await job_service.update_progress(
            job_id, JobStatus.FAILED, "sign in again to change access"
        )
        return
    parsed = PublishingDefaults.model_validate(settings)
    updated: list[int] = []
    failed: list[int] = []
    for track_id in track_ids:
        await job_service.update_progress(
            job_id,
            JobStatus.PROCESSING,
            f"updating track {len(updated) + len(failed) + 1} of {len(track_ids)}",
        )
        try:
            await apply_publishing(track_id, parsed, origin, session)
            updated.append(track_id)
        except Exception:
            logger.exception("publishing change failed for track %s", track_id)
            failed.append(track_id)
    await job_service.update_progress(
        job_id,
        JobStatus.FAILED if failed else JobStatus.COMPLETED,
        "some tracks could not be updated" if failed else "access updated",
        result={"updated_track_ids": updated, "failed_track_ids": failed},
    )


async def queue_publishing_change(
    session: Session, track_ids: list[int], settings: PublishingDefaults, origin: str
) -> PublishingJobResponse:
    job_id = await job_service.create_job(
        JobType.PUBLISHING, session.did, "access change queued"
    )
    try:
        await get_docket().add(run_publishing_change)(
            job_id, session.session_id, track_ids, settings.model_dump(), origin
        )
    except Exception:
        await job_service.update_progress(
            job_id, JobStatus.FAILED, "could not queue access change"
        )
        raise
    return PublishingJobResponse(job_id=job_id)


@router.post("/{track_id}/publishing")
async def change_track_publishing(
    track_id: int,
    body: PublishingChange,
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Session = Depends(require_auth),
) -> PublishingJobResponse:
    track = await db.get(Track, track_id)
    if track is None or track.artist_did != session.did:
        raise HTTPException(status_code=404, detail="track not found")
    prefs = await db.get(UserPreferences, session.did)
    album = await db.get(Album, track.album_id) if track.album_id else None
    resolved = resolve_publishing(
        portal=PublishingDefaults.model_validate(
            prefs.publishing_defaults if prefs else {}
        ),
        album=PublishingDefaults.model_validate(album.publishing_defaults)
        if album and album.publishing_defaults
        else None,
        track=body.settings,
    )
    return await queue_publishing_change(
        session, [track_id], resolved.settings, resolved.origin
    )


class PublishingJobStatus(BaseModel):
    status: str
    message: str | None
    updated_track_ids: list[int]
    failed_track_ids: list[int]


@router.get("/publishing-jobs/{job_id}")
async def publishing_job_status(
    job_id: str, session: Session = Depends(require_auth)
) -> PublishingJobStatus:
    job = await job_service.get_job(job_id)
    if (
        job is None
        or job.owner_did != session.did
        or job.type != JobType.PUBLISHING.value
    ):
        raise HTTPException(status_code=404, detail="access change not found")
    result = job.result or {}
    return PublishingJobStatus(
        status=job.status,
        message=job.message,
        updated_track_ids=result.get("updated_track_ids", []),
        failed_track_ids=result.get("failed_track_ids", []),
    )
