"""deferred MP3 optimization for tracks published with the interim WAV rendition.

a lossless (AIFF) upload publishes immediately with a fast 16-bit WAV
compatibility rendition (see `uploads._store_audio`) so the track exists in
seconds and plays in every browser, instead of blocking on a multi-minute,
single-threaded MP3 encode. this background task then produces the smaller MP3
streaming rendition from the lossless original, swaps it in as the canonical
playable file, and writes the single PDS `audioBlob` — all off the upload's
critical path. nothing here is reaped by the stuck-upload reaper (it runs under
a distinct `JobType.OPTIMIZE` row) and it uses a generous transcoder timeout
since no user is waiting.

failure is safe: the track simply stays on its WAV rendition (fully consistent
— DB row, R2 object, and PDS record all agree), and the orphaned MP3 (if any)
is cleaned up. docket retries the task.
"""

import contextlib
import logging
from dataclasses import dataclass
from datetime import datetime

import logfire
from docket import ConcurrencyLimit
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend._internal import get_session
from backend._internal.atproto.records import build_track_record, update_record
from backend._internal.audio import AudioFormat
from backend._internal.background import get_docket
from backend._internal.jobs import job_service
from backend._internal.tasks.hooks import invalidate_tracks_discovery_cache
from backend.api.tracks.uploads import (
    AudioInfo,
    PdsBlobResult,
    StorageResult,
    UploadContext,
    _transcode_audio,
    _upload_to_pds,
)
from backend.config import settings
from backend.models import Track
from backend.models.job import JobStatus, JobType
from backend.storage import storage
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)

OPTIMIZE_TARGET_FORMAT = "mp3"


class _OptimizeAbort(Exception):
    """internal signal to abort the optimization; the track stays on WAV."""


@dataclass
class _AudioState:
    """immutable audio identifiers captured at the start of optimization.

    the lossless original and the interim WAV don't change while we encode, so
    we snapshot them once. mutable metadata (title / album / image / …) is
    re-read right before the record rebuild instead — the encode can run for
    minutes, plenty of time for a concurrent edit we must not clobber.
    """

    track_id: int
    artist_did: str
    atproto_record_uri: str
    original_file_id: str
    original_file_type: str
    interim_file_id: str
    interim_file_type: str
    created_at: datetime


@dataclass
class _MetadataState:
    """track metadata re-read immediately before rebuilding the ATProto record."""

    title: str
    artist_display_name: str
    album: str | None
    duration: int | None
    features: list[dict]
    image_url: str | None
    description: str | None
    support_gate: dict | None
    atproto_record_uri: str


def _needs_optimization(track: Track) -> bool:
    """a track is optimizable iff it currently serves the interim WAV rendition
    over a lossless original. an already-swapped (mp3) track is a no-op, which
    makes the task idempotent under docket retries."""
    return (
        track.file_type == AudioFormat.WAV.value
        and track.original_file_id is not None
        and track.original_file_type is not None
    )


async def _load_audio_state(track_id: int) -> _AudioState | None:
    """initial load + idempotency guard. returns None to skip (not found, or
    already optimized)."""
    async with db_session() as db:
        track = (
            await db.execute(select(Track).where(Track.id == track_id))
        ).scalar_one_or_none()
        if track is None:
            logger.warning("optimize: track %s not found", track_id)
            return None
        if not track.atproto_record_uri:
            logger.warning(
                "optimize: track %s has no ATProto record; skipping", track_id
            )
            return None
        if not _needs_optimization(track):
            logfire.info(
                "optimize: track already optimized or not applicable",
                track_id=track_id,
                file_type=track.file_type,
            )
            return None
        # mypy/ty: _needs_optimization guarantees these are set
        assert track.original_file_id is not None
        assert track.original_file_type is not None
        return _AudioState(
            track_id=track.id,
            artist_did=track.artist_did,
            atproto_record_uri=track.atproto_record_uri,
            original_file_id=track.original_file_id,
            original_file_type=track.original_file_type,
            interim_file_id=track.file_id,
            interim_file_type=track.file_type,
            created_at=track.created_at,
        )


async def _refresh_metadata(state: _AudioState) -> _MetadataState:
    """re-read mutable metadata right before publishing so a concurrent
    `PATCH /tracks/{id}` during the (minutes-long) encode isn't clobbered."""
    async with db_session() as db:
        track = (
            await db.execute(
                select(Track)
                .options(selectinload(Track.artist))
                .where(Track.id == state.track_id)
            )
        ).scalar_one_or_none()
        if track is None or not track.atproto_record_uri:
            raise _OptimizeAbort("track removed during optimization")
        return _MetadataState(
            title=track.title,
            artist_display_name=track.artist.display_name,
            album=track.album,
            duration=track.duration,
            features=list(track.features) if track.features else [],
            image_url=await track.get_image_url(),
            description=track.description,
            support_gate=dict(track.support_gate) if track.support_gate else None,
            atproto_record_uri=track.atproto_record_uri,
        )


async def _commit_optimize_swap(
    state: _AudioState,
    sr: StorageResult,
    pds_result: PdsBlobResult | None,
    new_record_cid: str,
) -> None:
    """swap the playable rendition to MP3 in a single statement.

    only audio fields are touched — title/album/features/etc. are left alone so
    a concurrent metadata edit survives. the lossless original is preserved.
    genre/embedding provenance is NOT cleared: the audio content is unchanged
    (same source), so those results stay valid.
    """
    has_pds_blob = bool(pds_result and pds_result.cid)
    async with db_session() as db:
        track = await db.get(Track, state.track_id)
        if track is None:
            raise _OptimizeAbort("track removed during optimization")
        track.file_id = sr.file_id
        track.file_type = OPTIMIZE_TARGET_FORMAT
        track.r2_url = sr.r2_url
        track.original_file_id = state.original_file_id
        track.original_file_type = state.original_file_type
        track.audio_storage = "both" if has_pds_blob else "r2"
        track.pds_blob_cid = pds_result.cid if pds_result else None
        track.pds_blob_size = pds_result.size if pds_result else None
        track.atproto_record_cid = new_record_cid
        await db.commit()


async def optimize_track_audio(
    track_id: int,
    session_id: str,
    concurrency: ConcurrencyLimit = ConcurrencyLimit(
        "session_id", max_concurrent=2
    ),
) -> None:
    """produce + swap in the MP3 streaming rendition for a WAV-published track.

    enqueued by the upload / audio-replace pipelines right after a lossless
    track is published with its interim WAV rendition.
    """
    with logfire.span("optimize track audio", track_id=track_id):
        session = await get_session(session_id)
        if session is None:
            logger.warning(
                "optimize: session %s gone; track %s stays on WAV",
                session_id,
                track_id,
            )
            return

        state = await _load_audio_state(track_id)
        if state is None:
            return

        job_id = await job_service.create_job(
            JobType.OPTIMIZE, state.artist_did, "optimizing audio..."
        )

        new_mp3_file_id: str | None = None
        try:
            transcode_info = await _transcode_audio(
                job_id,
                state.original_file_id,
                f"track.{state.original_file_type}",
                state.original_file_type,
                target_format=OPTIMIZE_TARGET_FORMAT,
                timeout_seconds=settings.transcoder.optimize_timeout_seconds,
            )
            if not transcode_info:
                # _transcode_audio already marked the job failed with detail.
                raise _OptimizeAbort("transcode to mp3 failed")
            new_mp3_file_id = transcode_info.transcoded_file_id

            mp3_url = await storage.get_url(
                new_mp3_file_id, file_type="audio", extension=OPTIMIZE_TARGET_FORMAT
            )
            if not mp3_url:
                raise _OptimizeAbort("failed to resolve mp3 url")

            sr = StorageResult(
                file_id=new_mp3_file_id,
                original_file_id=state.original_file_id,
                original_file_type=state.original_file_type,
                playable_format=AudioFormat.MP3,
                r2_url=mp3_url,
                transcode_info=transcode_info,
                needs_optimization=False,
            )
            audio_info = AudioInfo(
                format=AudioFormat.MP3, duration=None, is_gated=False
            )
            phase_ctx = UploadContext(
                upload_id=job_id,
                auth_session=session,
                audio_file_id=new_mp3_file_id,
                filename=f"track.{OPTIMIZE_TARGET_FORMAT}",
                duration=None,
                title="",
                artist_did=state.artist_did,
                album=None,
                album_id=None,
                features_json=None,
                tags=[],
            )
            pds_result = await _upload_to_pds(phase_ctx, audio_info, sr)
            if pds_result and (refreshed := await get_session(session_id)):
                session = refreshed

            meta = await _refresh_metadata(state)
            new_record = await build_track_record(
                title=meta.title,
                artist=meta.artist_display_name,
                audio_url=mp3_url,
                file_type=OPTIMIZE_TARGET_FORMAT,
                album=meta.album,
                duration=meta.duration,
                features=meta.features or None,
                image_url=meta.image_url,
                support_gate=meta.support_gate,
                audio_blob=pds_result.blob_ref if pds_result else None,
                description=meta.description,
                created_at=state.created_at,
            )
            _, new_cid = await update_record(
                auth_session=session,
                record_uri=meta.atproto_record_uri,
                record=new_record,
            )

            await _commit_optimize_swap(state, sr, pds_result, new_cid)

        except Exception as e:
            # leave the track on its WAV rendition (consistent); drop the
            # orphaned MP3. docket retries; the track keeps playing meanwhile.
            if new_mp3_file_id:
                with contextlib.suppress(Exception):
                    await storage.delete(new_mp3_file_id, OPTIMIZE_TARGET_FORMAT)
            await job_service.update_progress(
                job_id, JobStatus.FAILED, "optimization failed", error=str(e)
            )
            if isinstance(e, _OptimizeAbort):
                logger.warning("optimize: aborted for track %s: %s", track_id, e)
            else:
                logger.exception(
                    "optimize: track %s failed; staying on WAV", track_id
                )
            return

        # post-commit: the interim WAV is now orphaned — delete it. best-effort;
        # a leaked WAV is harmless (no row references it) and cheap to sweep.
        with contextlib.suppress(Exception):
            await storage.delete(state.interim_file_id, state.interim_file_type)
        with contextlib.suppress(Exception):
            await invalidate_tracks_discovery_cache()

        await job_service.update_progress(
            job_id,
            JobStatus.COMPLETED,
            "audio optimized",
            result={"track_id": track_id, "file_id": new_mp3_file_id},
        )
        logfire.info(
            "optimize: swapped track to mp3 rendition",
            track_id=track_id,
            mp3_file_id=new_mp3_file_id,
        )


async def schedule_optimize_track_audio(track_id: int, session_id: str) -> None:
    """enqueue the deferred MP3 optimization for a WAV-published track."""
    docket = get_docket()
    await docket.add(optimize_track_audio)(track_id, session_id)
    logfire.info("scheduled track audio optimization", track_id=track_id)
