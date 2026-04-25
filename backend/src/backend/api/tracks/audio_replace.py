"""replace the audio file backing an existing track.

PUT /tracks/{track_id}/audio uploads new audio bytes for an existing track,
keeping the track's stable identity (id, atproto URI, likes, comments, plays)
while atomically swapping the underlying file in R2 and on the user's PDS.

design notes:
- the track URI never changes, so likes/playlists/comments keep working.
- the track record CID does change (new audioUrl/audioBlob/duration). this is
  the same CID-churn behavior as PATCH /tracks/{id} today, which the rest of
  the system already tolerates.
- a labeler label that was attached to the old audio stays attached to the
  (URI-stable) track. operators must dismiss it manually if the new audio is
  clean. this is intentional — automatically dismissing copyright labels would
  be a moderation hole.
- the old audio is NOT deleted on replace. it's snapshotted into a
  TrackRevision row inside the same transaction as the swap, so users can
  roll back. blobs are only deleted when revisions are pruned past the
  per-track retention cap (see `_internal/track_revisions.py`). PDS blobs
  are left to PDS garbage collection regardless.
"""

import contextlib
import logging
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated
from urllib.parse import urljoin

import logfire
from docket import ConcurrencyLimit
from fastapi import (
    Depends,
    File,
    HTTPException,
    Request,
    UploadFile,
)
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import get_session, require_auth
from backend._internal.atproto.records import (
    build_track_record,
    update_record,
)
from backend._internal.audio import AudioFormat
from backend._internal.background import get_docket
from backend._internal.jobs import job_service
from backend._internal.tasks import schedule_album_list_sync
from backend._internal.tasks.hooks import (
    invalidate_tracks_discovery_cache,
    run_post_track_audio_replace_hooks,
)
from backend._internal.track_revisions import prune_revisions
from backend.api.albums import invalidate_album_cache_by_id
from backend.api.tracks.uploads import (
    AudioInfo,
    PdsBlobResult,
    StorageResult,
    UploadContext,
    UploadPhaseError,
    UploadStartResponse,
    _store_audio,
    _upload_to_pds,
    _validate_audio,
    stage_audio_to_storage,
)
from backend.config import settings
from backend.models import Track, TrackRevision
from backend.models.job import JobStatus, JobType
from backend.storage import storage
from backend.utilities.audio import extract_duration
from backend.utilities.database import db_session
from backend.utilities.hashing import CHUNK_SIZE
from backend.utilities.rate_limit import limiter

from .router import router

logger = logging.getLogger(__name__)


@dataclass
class TrackAudioState:
    """snapshot of a track's audio fields, captured before replacement.

    used for rebuilding the track ATProto record (preserving non-audio
    metadata like title/album/features/image) on top of the new audio.
    the old audio is preserved separately as a TrackRevision row written
    inside the swap transaction.
    """

    track_id: int
    artist_did: str
    artist_display_name: str
    atproto_record_uri: str

    # current audio state (for rollback / cleanup)
    old_file_id: str
    old_file_type: str
    old_original_file_id: str | None
    old_original_file_type: str | None

    # non-audio metadata (preserved across the rebuild)
    title: str
    album: str | None
    duration: int | None  # current duration; replaced with new duration in new record
    features: list[dict]
    image_url: str | None
    description: str | None
    support_gate: dict | None


@dataclass
class ReplaceContext:
    """all data needed to process an audio replace in the background.

    new audio bytes are staged to shared object storage by the HTTP
    handler BEFORE this context is enqueued — the worker only ever
    sees stable storage identifiers. see `UploadContext` for the same
    invariant on the upload side.
    """

    job_id: str
    auth_session: AuthSession
    track_id: int
    audio_file_id: str
    filename: str
    duration: int | None


async def _load_and_authorize(
    track_id: int, auth_session: AuthSession
) -> TrackAudioState:
    """phase 1: load the track, verify ownership, snapshot current audio state."""
    async with db_session() as db:
        result = await db.execute(
            select(Track)
            .options(selectinload(Track.artist))
            .where(Track.id == track_id)
        )
        track = result.scalar_one_or_none()

        if not track:
            raise UploadPhaseError("track not found")
        if track.artist_did != auth_session.did:
            raise UploadPhaseError("you can only replace audio on your own tracks")
        if not track.atproto_record_uri:
            raise UploadPhaseError(
                "this track has no ATProto record — restore it before replacing audio"
            )

        return TrackAudioState(
            track_id=track.id,
            artist_did=track.artist_did,
            artist_display_name=track.artist.display_name,
            atproto_record_uri=track.atproto_record_uri,
            old_file_id=track.file_id,
            old_file_type=track.file_type,
            old_original_file_id=track.original_file_id,
            old_original_file_type=track.original_file_type,
            title=track.title,
            album=track.album,
            duration=track.duration,
            features=list(track.features) if track.features else [],
            image_url=await track.get_image_url(),
            description=track.description,
            support_gate=dict(track.support_gate) if track.support_gate else None,
        )


def _build_upload_context_for_phases(
    ctx: ReplaceContext, state: TrackAudioState
) -> UploadContext:
    """build a stub UploadContext so the existing phase helpers work unchanged.

    only the audio-related fields matter to `_validate_audio`, `_store_audio`,
    `_upload_to_pds`. the rest are filled with sensible defaults that the
    helpers don't read (we never call `_create_records`).
    """
    return UploadContext(
        upload_id=ctx.job_id,
        auth_session=ctx.auth_session,
        audio_file_id=ctx.audio_file_id,
        filename=ctx.filename,
        duration=ctx.duration,
        title=state.title,
        artist_did=state.artist_did,
        album=state.album,
        album_id=None,
        features_json=None,
        tags=[],
        support_gate=state.support_gate,
    )


def _audio_url_for_record(state: TrackAudioState, sr: StorageResult) -> str:
    """compute the audioUrl field for the new ATProto record.

    gated tracks point at the auth-protected backend endpoint; public tracks
    point at the public storage URL.
    """
    if state.support_gate is not None:
        backend_url = settings.atproto.redirect_uri.rsplit("/", 2)[0]
        return urljoin(backend_url + "/", f"audio/{sr.file_id}")
    assert sr.r2_url is not None  # public tracks always have an r2_url
    return sr.r2_url


async def _publish_record_update(
    ctx: ReplaceContext,
    state: TrackAudioState,
    audio_info: AudioInfo,
    sr: StorageResult,
    pds_result: PdsBlobResult | None,
) -> str:
    """phase 5: rebuild the track ATProto record with new audio fields.

    raises UploadPhaseError on failure. the new R2 file is cleaned up by the
    orchestrator on rollback.

    returns the new record CID.
    """
    playable_file_type = (
        sr.playable_format.value
        if sr.playable_format
        else Path(ctx.filename).suffix.lower().lstrip(".")
    )

    new_record = build_track_record(
        title=state.title,
        artist=state.artist_display_name,
        audio_url=_audio_url_for_record(state, sr),
        file_type=playable_file_type,
        album=state.album,
        duration=audio_info.duration,
        features=state.features or None,
        image_url=state.image_url,
        support_gate=state.support_gate,
        audio_blob=pds_result.blob_ref if pds_result else None,
        description=state.description,
    )

    try:
        _, new_cid = await update_record(
            auth_session=ctx.auth_session,
            record_uri=state.atproto_record_uri,
            record=new_record,
        )
    except Exception as exc:
        logfire.exception(
            "audio replace: failed to update ATProto record",
            track_id=state.track_id,
            record_uri=state.atproto_record_uri,
        )
        raise UploadPhaseError(f"failed to publish updated record: {exc}") from exc

    return new_cid


async def _commit_db_swap(
    state: TrackAudioState,
    audio_info: AudioInfo,
    sr: StorageResult,
    pds_result: PdsBlobResult | None,
    new_record_cid: str,
) -> Track:
    """phase 6: atomically swap track audio fields AND snapshot the displaced
    audio into a new TrackRevision row, in a single transaction.

    the snapshot has to share the transaction with the swap — otherwise a crash
    between the two would either lose history (snapshot first, swap fails) or
    corrupt the row pointed-at-but-no-longer-current (swap first, snapshot
    fails, blob still in R2 but no row owns it).

    clears the auto_tag flag and stale genre prediction provenance so the
    post-replace hooks make a clean re-classification decision.
    """
    playable_file_type = (
        sr.playable_format.value
        if sr.playable_format
        else state.old_file_type  # transcode shouldn't have run if web-playable; safe fallback
    )
    has_pds_blob = bool(pds_result and pds_result.cid)

    async with db_session() as db:
        track = await db.get(Track, state.track_id)
        if not track:
            # extremely unlikely race: track deleted between authorize and commit
            raise UploadPhaseError("track was deleted during replace")

        # snapshot the about-to-be-displaced audio into a revision row BEFORE
        # overwriting. this row now owns the old blob — the post-commit cleanup
        # path no longer deletes it. pruning (post-commit, best-effort) handles
        # long-term retention and blob deletion when revisions exceed the cap.
        snapshot = TrackRevision(
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
            was_gated=track.support_gate is not None,
        )
        db.add(snapshot)

        track.file_id = sr.file_id
        track.file_type = playable_file_type
        track.original_file_id = sr.original_file_id
        track.original_file_type = sr.original_file_type
        track.r2_url = sr.r2_url
        track.audio_storage = "both" if has_pds_blob else "r2"
        track.pds_blob_cid = pds_result.cid if pds_result else None
        track.pds_blob_size = pds_result.size if pds_result else None
        track.atproto_record_cid = new_record_cid

        # update duration; clear stale genre-prediction provenance so a future
        # re-classification doesn't get short-circuited as "already done".
        extra = dict(track.extra) if track.extra else {}
        if audio_info.duration is not None:
            extra["duration"] = audio_info.duration
        extra.pop("genre_predictions", None)
        extra.pop("genre_predictions_file_id", None)
        track.extra = extra

        await db.commit()
        await db.refresh(track)
        return track


async def _maybe_resync_album_list(track: Track, auth_session: AuthSession) -> None:
    """if the track is in an album, refresh the album list record so its
    embedded strongRef carries the new track CID."""
    if track.album_id:
        await schedule_album_list_sync(auth_session.session_id, track.album_id)
        async with db_session() as db:
            await invalidate_album_cache_by_id(db, track.album_id)


async def _process_replace_background(ctx: ReplaceContext) -> None:
    """orchestrate the audio replace pipeline.

    the pipeline is split into two halves around the DB swap:

    pre-commit (rollback applies — failure deletes the new playable file):
        1. load + authorize
        2. validate new bytes
        3. store new bytes (transcode if needed; the staged file_id is the
           lossless original when transcoding, the playable file otherwise)
        4. upload to PDS (best-effort)
        5. publish updated ATProto record (PUT)
        6. atomically swap the DB row

    post-commit (NO rollback — the track is replaced; failures are logged):
        7. fire post-replace hooks (rescan, re-embed, re-classify)
        8. resync album list record
        9. invalidate discovery cache

    the split is critical: once `_commit_db_swap` returns, the track row points
    at the new file and the ATProto record is published. tearing down the new
    storage object at that point would leave production looking at a broken
    track.
    """
    new_file_id_for_rollback: str | None = None
    new_original_file_id_for_rollback: str | None = None
    new_original_file_type_for_rollback: str | None = None
    rollback_gated: bool = False

    with logfire.span(
        "process audio replace background",
        job_id=ctx.job_id,
        track_id=ctx.track_id,
        filename=ctx.filename,
    ):
        # ---- pre-commit (rollback applies) ----
        try:
            await job_service.update_progress(
                ctx.job_id, JobStatus.PROCESSING, "preparing audio replace..."
            )

            state = await _load_and_authorize(ctx.track_id, ctx.auth_session)
            rollback_gated = state.support_gate is not None
            phase_ctx = _build_upload_context_for_phases(ctx, state)

            audio_info = await _validate_audio(phase_ctx)
            sr = await _store_audio(phase_ctx, audio_info)
            new_file_id_for_rollback = sr.file_id
            new_original_file_id_for_rollback = sr.original_file_id
            new_original_file_type_for_rollback = sr.original_file_type

            pds_result = await _upload_to_pds(phase_ctx, audio_info, sr)

            # the PDS upload may have refreshed the OAuth token in-place; pull
            # the freshest session for the upcoming putRecord call.
            if pds_result and (
                refreshed := await get_session(ctx.auth_session.session_id)
            ):
                ctx.auth_session = refreshed

            # defensive re-load: a concurrent PATCH may have updated title /
            # album / features / image / description / support_gate / unlisted
            # while we were uploading. publish with the freshest non-audio
            # metadata so we don't roll the user's edit back on PDS.
            state = await _refresh_metadata_state(state)

            new_cid = await _publish_record_update(
                ctx, state, audio_info, sr, pds_result
            )

            track = await _commit_db_swap(state, audio_info, sr, pds_result, new_cid)

        except UploadPhaseError as e:
            await _rollback_new_files(
                new_file_id_for_rollback,
                new_original_file_id_for_rollback,
                new_original_file_type_for_rollback,
                gated=rollback_gated,
            )
            await job_service.update_progress(
                ctx.job_id, JobStatus.FAILED, "audio replace failed", error=e.error
            )
            return
        except Exception as e:
            await _rollback_new_files(
                new_file_id_for_rollback,
                new_original_file_id_for_rollback,
                new_original_file_type_for_rollback,
                gated=rollback_gated,
            )
            logger.exception(
                "audio replace job %s failed with unexpected error", ctx.job_id
            )
            await job_service.update_progress(
                ctx.job_id,
                JobStatus.FAILED,
                "audio replace failed",
                error=f"unexpected error: {e!s}",
            )
            return

        # ---- post-commit (NO rollback — the swap is committed) ----
        # each side effect is best-effort. if any fails we log and keep going;
        # the track is already pointing at the new audio.
        # the OLD audio is NOT deleted here — it now belongs to the revision
        # row inserted alongside the swap. pruning (below) handles long-term
        # retention and blob cleanup when the per-track cap is exceeded.
        await prune_revisions(state.track_id)

        try:
            await run_post_track_audio_replace_hooks(track.id, audio_url=sr.r2_url)
        except Exception:
            logger.exception(
                "audio replace: post-replace hooks failed (track is replaced; "
                "copyright/embedding/genre re-runs may not have been scheduled)",
            )

        try:
            await _maybe_resync_album_list(track, ctx.auth_session)
        except Exception:
            logger.exception(
                "audio replace: album list resync failed (track is replaced; "
                "album record's strongRef may carry a stale CID until next edit)",
            )

        with contextlib.suppress(Exception):
            await invalidate_tracks_discovery_cache()

        await job_service.update_progress(
            ctx.job_id,
            JobStatus.COMPLETED,
            "audio replaced",
            result={
                "track_id": track.id,
                "atproto_uri": track.atproto_record_uri,
                "atproto_cid": track.atproto_record_cid,
            },
        )


async def _refresh_metadata_state(state: TrackAudioState) -> TrackAudioState:
    """reload non-audio fields right before publishing the ATProto record.

    minimizes the window in which a concurrent `PATCH /tracks/{id}` (title,
    description, image, features, support_gate) gets clobbered by the stale
    metadata we captured at `_load_and_authorize` time.
    """
    async with db_session() as db:
        result = await db.execute(
            select(Track)
            .options(selectinload(Track.artist))
            .where(Track.id == state.track_id)
        )
        track = result.scalar_one_or_none()
        if not track:
            # row vanished between authorize and publish; let the caller
            # raise the same UploadPhaseError it would have on _commit_db_swap.
            raise UploadPhaseError("track was deleted during replace")
        return TrackAudioState(
            track_id=track.id,
            artist_did=track.artist_did,
            artist_display_name=track.artist.display_name,
            atproto_record_uri=track.atproto_record_uri or state.atproto_record_uri,
            old_file_id=state.old_file_id,
            old_file_type=state.old_file_type,
            old_original_file_id=state.old_original_file_id,
            old_original_file_type=state.old_original_file_type,
            title=track.title,
            album=track.album,
            duration=track.duration,
            features=list(track.features) if track.features else [],
            image_url=await track.get_image_url(),
            description=track.description,
            support_gate=dict(track.support_gate) if track.support_gate else None,
        )


async def _rollback_new_files(
    new_file_id: str | None,
    new_original_file_id: str | None,
    new_original_file_type: str | None,
    *,
    gated: bool,
) -> None:
    """delete any new R2 object we wrote before discovering the operation must abort.

    `gated=True` routes the playable-file delete to the private bucket. transcode
    originals always live in the public bucket (gated tracks can't be lossless),
    so the original delete uses the public path unconditionally.
    """
    if new_file_id:
        delete_fn = storage.delete_gated if gated else storage.delete
        with contextlib.suppress(Exception):
            await delete_fn(new_file_id)
    if new_original_file_id:
        with contextlib.suppress(Exception):
            await storage.delete(new_original_file_id, new_original_file_type)


# -- background task registration -----------------------------------------------


async def run_track_audio_replace(
    job_id: str,
    session_id: str,
    user_did: str,
    track_id: int,
    audio_file_id: str,
    filename: str,
    duration: int | None,
    concurrency: ConcurrencyLimit = ConcurrencyLimit("user_did", max_concurrent=3),
) -> None:
    """docket task entry point for audio replace.

    takes primitive args + a shared-storage `audio_file_id` (the new
    bytes are staged to storage by the HTTP handler before this task is
    enqueued). rehydrates the auth session from the stored session_id,
    constructs a ReplaceContext, and delegates to the phase orchestrator
    (`_process_replace_background`).

    **never accept filesystem paths here** — see the matching note on
    `run_track_upload`. workers may run on a different fly machine than
    the request handler.

    `ConcurrencyLimit("user_did", max_concurrent=3)` caps concurrent
    replaces per user's DID at 3 — same as the upload task. prevents a
    user kicking off many replaces at once from overwhelming their PDS's
    connection-limit tolerance.
    """
    auth_session = await get_session(session_id)
    if auth_session is None:
        await job_service.update_progress(
            job_id,
            JobStatus.FAILED,
            "audio replace failed",
            error="authentication session expired before processing could begin",
        )
        return

    ctx = ReplaceContext(
        job_id=job_id,
        auth_session=auth_session,
        track_id=track_id,
        audio_file_id=audio_file_id,
        filename=filename,
        duration=duration,
    )
    await _process_replace_background(ctx)


async def schedule_track_audio_replace(ctx: ReplaceContext) -> None:
    """enqueue an audio replace as a docket task.

    by contract this function only forwards small primitives + storage
    identifiers — never local filesystem paths. the HTTP handler should
    return to the client as soon as this call resolves; transcode / PDS /
    ATProto work runs on a docket worker with bounded concurrency so
    concurrent replaces can't saturate the DB pool.
    """
    docket = get_docket()
    await docket.add(run_track_audio_replace)(
        job_id=ctx.job_id,
        session_id=ctx.auth_session.session_id,
        user_did=ctx.auth_session.did,
        track_id=ctx.track_id,
        audio_file_id=ctx.audio_file_id,
        filename=ctx.filename,
        duration=ctx.duration,
    )


# -- HTTP surface ----------------------------------------------------------------


@router.put("/{track_id}/audio")
@limiter.limit(settings.rate_limit.upload_limit)
async def replace_track_audio(
    request: Request,
    track_id: int,
    auth_session: Annotated[AuthSession, Depends(require_auth)],
    file: UploadFile = File(...),
) -> UploadStartResponse:
    """Replace the audio file backing an existing track (owner only).

    The track id, ATProto URI, likes, comments, plays, tags, and album linkage
    all carry over. Only the audio bytes (and derived fields: duration,
    fingerprint, embedding) are replaced.

    Returns the same `UploadStartResponse` shape as `POST /tracks/`, so callers
    can reuse the existing `GET /tracks/uploads/{upload_id}/progress` SSE
    endpoint to follow progress.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="no filename provided")

    ext = Path(file.filename).suffix.lower()
    if not (audio_format := AudioFormat.from_extension(ext)):
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported file type: {ext}. "
                f"supported: {AudioFormat.supported_extensions_str()}"
            ),
        )
    del audio_format  # validated; the background pipeline re-derives it

    # cheap pre-check so we 404/403 before streaming a multi-MB body to disk.
    # also captures the track's gating state — needed up here so the staged
    # bytes land in the right bucket (private for gated, public otherwise).
    async with db_session() as db:
        result = await db.execute(
            select(
                Track.artist_did, Track.atproto_record_uri, Track.support_gate
            ).where(Track.id == track_id)
        )
        row = result.first()
        if not row:
            raise HTTPException(status_code=404, detail="track not found")
        artist_did, atproto_uri, support_gate = row
        if artist_did != auth_session.did:
            raise HTTPException(
                status_code=403,
                detail="you can only replace audio on your own tracks",
            )
        if not atproto_uri:
            raise HTTPException(
                status_code=400,
                detail=(
                    "this track has no ATProto record — restore it before "
                    "replacing audio"
                ),
            )
        is_gated = support_gate is not None

    # stage the new audio bytes to shared object storage BEFORE enqueueing
    # the docket task. workers may pick up the task on a different fly
    # machine than this handler — only stable storage identifiers should
    # cross that boundary.
    job_id = await job_service.create_job(
        JobType.UPLOAD,
        auth_session.did,
        "audio replace queued for processing",
    )

    file_path: str | None = None
    try:
        max_size = settings.storage.max_upload_size_mb * 1024 * 1024
        bytes_read = 0
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            file_path = tmp.name
            while chunk := await file.read(CHUNK_SIZE):
                bytes_read += len(chunk)
                if bytes_read > max_size:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"file too large (max "
                            f"{settings.storage.max_upload_size_mb}MB)"
                        ),
                    )
                tmp.write(chunk)

        with open(file_path, "rb") as f:
            duration = extract_duration(f)

        with open(file_path, "rb") as f:
            audio_file_id = await stage_audio_to_storage(
                job_id, f, file.filename, gated=is_gated
            )

        await schedule_track_audio_replace(
            ReplaceContext(
                job_id=job_id,
                auth_session=auth_session,
                track_id=track_id,
                audio_file_id=audio_file_id,
                filename=file.filename,
                duration=duration,
            ),
        )
    finally:
        if file_path:
            with contextlib.suppress(Exception):
                Path(file_path).unlink(missing_ok=True)

    return UploadStartResponse(
        upload_id=job_id,
        status="pending",
        message="audio replace queued for processing",
    )
