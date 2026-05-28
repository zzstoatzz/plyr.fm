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
from datetime import datetime, timedelta

import logfire
from docket import ConcurrencyLimit, ExponentialRetry
from sqlalchemy import select
from sqlalchemy import update as sa_update
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

# docket retry on transient failures (transcoder hiccup, PDS 5xx, DB blip).
# fewer attempts than the ingest tasks because each retry re-runs the ~minutes
# MP3 encode, so hammering is wasteful — a small handful with real backoff is
# the right shape. terminal aborts (_OptimizeAbort) are caught and swallowed so
# docket sees a clean completion and does not retry them.
_OPTIMIZE_RETRY = ExponentialRetry(
    attempts=3,
    minimum_delay=timedelta(seconds=30),
    maximum_delay=timedelta(minutes=5),
)


class _OptimizeAbort(Exception):
    """internal signal that the optimization can't (or shouldn't) proceed —
    the track is no longer in the state we captured, or its session is gone.
    swallowed by the orchestrator so docket does not retry."""


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


async def _verify_still_optimizable(state: _AudioState) -> None:
    """abort if the track has been replaced/edited under us during the encode.

    closes the race with `audio_replace` (and any direct audio mutation): the
    MP3 encode can run for minutes, plenty of time for a user to upload new
    audio. if we proceed without checking, we'd push a stale MP3 to the PDS
    record on top of the replacement and overwrite the DB row to match —
    silently undoing the user's replace.

    this check minimizes the race window before `update_record` but doesn't
    eliminate it; `_commit_optimize_swap` does the atomic CAS as the backstop.
    """
    async with db_session() as db:
        row = (
            await db.execute(
                select(Track.file_id, Track.original_file_id).where(
                    Track.id == state.track_id
                )
            )
        ).first()
        if row is None:
            raise _OptimizeAbort("track removed during optimization")
        current_file_id, current_original_file_id = row
        if (
            current_file_id != state.interim_file_id
            or current_original_file_id != state.original_file_id
        ):
            raise _OptimizeAbort(
                f"track audio changed during optimization "
                f"(file_id={current_file_id} vs captured {state.interim_file_id}; "
                f"original={current_original_file_id} vs captured "
                f"{state.original_file_id})"
            )


async def _commit_optimize_swap(
    state: _AudioState,
    sr: StorageResult,
    pds_result: PdsBlobResult | None,
    new_record_cid: str,
) -> bool:
    """conditional swap to the MP3 rendition. succeeds iff the track is still
    pointing at the captured interim WAV + lossless original (CAS via WHERE).

    returns True on success, False on CAS-miss — i.e. another operation has
    moved the audio under us between the pre-publish guard and now. the caller
    decides what to do with the new MP3 in the CAS-miss case (it stays for
    inconsistency-avoidance when PDS has already been updated to reference it).

    only audio fields are touched — title/album/features/etc. are left alone so
    a concurrent metadata edit survives. genre/embedding provenance is NOT
    cleared: the audio content is unchanged (same source), results stay valid.
    """
    has_pds_blob = bool(pds_result and pds_result.cid)
    async with db_session() as db:
        result = await db.execute(
            sa_update(Track)
            .where(
                Track.id == state.track_id,
                Track.file_id == state.interim_file_id,
                Track.original_file_id == state.original_file_id,
            )
            .values(
                file_id=sr.file_id,
                file_type=OPTIMIZE_TARGET_FORMAT,
                r2_url=sr.r2_url,
                audio_storage="both" if has_pds_blob else "r2",
                pds_blob_cid=pds_result.cid if pds_result else None,
                pds_blob_size=pds_result.size if pds_result else None,
                atproto_record_cid=new_record_cid,
            )
        )
        await db.commit()
        return result.rowcount == 1  # type: ignore[union-attr]


async def optimize_track_audio(
    track_id: int,
    session_id: str,
    concurrency: ConcurrencyLimit = ConcurrencyLimit("session_id", max_concurrent=2),
    retry: ExponentialRetry = _OPTIMIZE_RETRY,
) -> None:
    """produce + swap in the MP3 streaming rendition for a WAV-published track.

    enqueued by the upload / audio-replace pipelines right after a lossless
    track is published with its interim WAV rendition. transient failures
    (transcoder hiccup, PDS 5xx, DB blip) propagate so docket can retry under
    `_OPTIMIZE_RETRY`; terminal aborts (track moved on, session gone, already
    optimized) raise `_OptimizeAbort`, which is caught and swallowed.
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
        # set True the moment update_record returns successfully. once that's
        # happened, the PDS record references the new MP3 url + blob, so we
        # must NOT delete the R2 object even if the DB swap subsequently fails
        # — third-party PDS readers depend on the url being reachable. better
        # to leak storage than 404 their playback.
        pds_published = False
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
            # last cheap check before we go write to PDS: bail if the track has
            # been replaced/edited under us during the encode.
            await _verify_still_optimizable(state)

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
            pds_published = True

            swapped = await _commit_optimize_swap(state, sr, pds_result, new_cid)
            if not swapped:
                # CAS-miss: the track moved on between the pre-publish guard
                # and now. PDS has been written to point at our MP3, so we
                # cannot delete it — and an audio_replace racing us will (or
                # already has) rebuilt the PDS record to its own audio,
                # which will overwrite ours on the PDS side too. log the
                # inconsistency and abort terminally.
                raise _OptimizeAbort(
                    f"track {track_id} audio changed between PDS write and DB "
                    f"commit; leaving mp3 {new_mp3_file_id} in place"
                )

        except _OptimizeAbort as e:
            # terminal: track is no longer in our captured state. don't retry.
            # only clean up the new MP3 if we hadn't already pushed it to PDS;
            # once the record points at the url, third-party readers may be
            # using it.
            if new_mp3_file_id and not pds_published:
                with contextlib.suppress(Exception):
                    await storage.delete(new_mp3_file_id, OPTIMIZE_TARGET_FORMAT)
            await job_service.update_progress(
                job_id, JobStatus.FAILED, "optimization aborted", error=str(e)
            )
            logger.warning("optimize: aborted for track %s: %s", track_id, e)
            return

        except Exception as e:
            # transient: let docket retry. same cleanup discipline — keep the
            # mp3 if PDS already references it; the next attempt will reconcile.
            if new_mp3_file_id and not pds_published:
                with contextlib.suppress(Exception):
                    await storage.delete(new_mp3_file_id, OPTIMIZE_TARGET_FORMAT)
            await job_service.update_progress(
                job_id,
                JobStatus.FAILED,
                "optimization failed (retrying)",
                error=str(e),
            )
            logger.exception(
                "optimize: track %s transient failure; re-raising for retry",
                track_id,
            )
            raise

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
