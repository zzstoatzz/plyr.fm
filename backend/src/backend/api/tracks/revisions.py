"""list and restore previous audio versions of a track.

GET  /tracks/{track_id}/revisions                    — owner-only history
POST /tracks/{track_id}/revisions/{revision_id}/restore — owner-only revert

restore is an instant pointer-swap: the chosen revision's audio (already in
storage) becomes the live audio. the track.file_id update + the displaced
audio's snapshot + the chosen revision's deletion all share one DB
transaction. the PDS record is republished beforehand so its CID is what
lands in the row on commit.

a restore that would cross the public ↔ gated boundary is rejected with
409 — moving an existing blob between buckets isn't built yet, and serving
gated audio from the public bucket would defeat the gate. the user can
ungate, restore, then re-gate manually if needed.
"""

import logging
from datetime import datetime
from typing import Annotated
from urllib.parse import urljoin

import logfire
from fastapi import Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend._internal import Session as AuthSession
from backend._internal import require_auth
from backend._internal.atproto.records import build_track_record, update_record
from backend._internal.audio import AudioFormat
from backend._internal.track_revisions import prune_revisions
from backend.api.albums import invalidate_album_cache_by_id
from backend.config import settings
from backend.models import Track, TrackRevision
from backend.utilities.database import db_session

from .router import router

logger = logging.getLogger(__name__)


# -- response models -------------------------------------------------------------


class RevisionResponse(BaseModel):
    """one historical audio version of a track."""

    id: int
    track_id: int
    created_at: datetime
    file_type: str
    original_file_type: str | None
    audio_storage: str  # "r2" | "pds" | "both"
    duration: int | None
    was_gated: bool

    @classmethod
    def from_revision(cls, revision: TrackRevision) -> "RevisionResponse":
        return cls(
            id=revision.id,
            track_id=revision.track_id,
            created_at=revision.created_at,
            file_type=revision.file_type,
            original_file_type=revision.original_file_type,
            audio_storage=revision.audio_storage,
            duration=revision.duration,
            was_gated=revision.was_gated,
        )


class RevisionListResponse(BaseModel):
    """history payload returned to the owner of a track."""

    track_id: int
    revisions: list[RevisionResponse]


# -- helpers ---------------------------------------------------------------------


async def _load_owned_track(track_id: int, did: str) -> Track:
    """load a track and verify the caller owns it. raises 404/403."""
    async with db_session() as db:
        result = await db.execute(
            select(Track)
            .options(selectinload(Track.artist))
            .where(Track.id == track_id)
        )
        track = result.scalar_one_or_none()

    if not track:
        raise HTTPException(status_code=404, detail="track not found")
    if track.artist_did != did:
        raise HTTPException(
            status_code=403,
            detail="you can only view or restore revisions on your own tracks",
        )
    return track


def _audio_url_for_record(revision: TrackRevision) -> str:
    """compute the audioUrl field for a republished record on restore.

    gated tracks (`was_gated=True`) point at the auth-protected backend
    streaming endpoint; public tracks point at the stored audio_url
    directly.
    """
    if revision.was_gated:
        backend_url = settings.atproto.redirect_uri.rsplit("/", 2)[0]
        return urljoin(backend_url + "/", f"audio/{revision.file_id}")
    if not revision.audio_url:
        # public revision missing a CDN url — this shouldn't happen for any
        # revision created post-CDN-cutover, but guard the assertion anyway
        raise HTTPException(
            status_code=500,
            detail="revision missing audio_url; cannot republish record",
        )
    return revision.audio_url


# -- HTTP surface ----------------------------------------------------------------


@router.get("/{track_id}/revisions", response_model=RevisionListResponse)
async def list_track_revisions(
    track_id: int,
    auth_session: Annotated[AuthSession, Depends(require_auth)],
) -> RevisionListResponse:
    """List previous audio versions of a track, newest first (owner only).

    Returns history only — the current audio lives on the track row itself.
    """
    await _load_owned_track(track_id, auth_session.did)

    async with db_session() as db:
        result = await db.execute(
            select(TrackRevision)
            .where(TrackRevision.track_id == track_id)
            .order_by(TrackRevision.created_at.desc(), TrackRevision.id.desc())
        )
        revisions = list(result.scalars())

    return RevisionListResponse(
        track_id=track_id,
        revisions=[RevisionResponse.from_revision(r) for r in revisions],
    )


@router.post(
    "/{track_id}/revisions/{revision_id}/restore",
    response_model=RevisionResponse,
)
async def restore_track_revision(
    track_id: int,
    revision_id: int,
    auth_session: Annotated[AuthSession, Depends(require_auth)],
) -> RevisionResponse:
    """Restore a previous audio version (owner only).

    The chosen revision's audio becomes live in a single DB transaction:
    the displaced current audio is snapshotted into a new revision row,
    the track row is updated, and the chosen revision row is deleted (its
    content is now current). The PDS record is republished beforehand so
    its CID is what lands on the row when the transaction commits.

    Restore is rejected with 409 if it would cross the public ↔ gated
    boundary — moving blobs between buckets isn't built yet.
    """
    track = await _load_owned_track(track_id, auth_session.did)
    if not track.atproto_record_uri:
        raise HTTPException(
            status_code=400,
            detail=(
                "this track has no ATProto record — restore the record before "
                "restoring an audio revision"
            ),
        )

    # load the chosen revision and verify it belongs to this track
    async with db_session() as db:
        revision = await db.get(TrackRevision, revision_id)
    if not revision or revision.track_id != track_id:
        raise HTTPException(status_code=404, detail="revision not found")

    # gating compat check — see module docstring
    track_is_gated = track.support_gate is not None
    if revision.was_gated != track_is_gated:
        raise HTTPException(
            status_code=409,
            detail=(
                "restore would cross the public/gated boundary — "
                "ungate or re-gate the track first"
            ),
        )

    # build + publish the updated PDS record FIRST, mirroring the replace flow.
    # if this fails, we abort before touching the DB.
    #
    # if the revision carried a PDS blob ref, include it in the new record so
    # the user's PDS keeps its canonical copy of the audio. the blob itself is
    # NOT re-uploaded — we trust that PDS still has it (blobs are only GC'd
    # after a grace period post-dereference). if the blob has already been
    # GC'd by the user's PDS, this record is still valid; playback falls back
    # to audio_url (R2).
    audio_blob: dict | None = None
    if revision.pds_blob_cid:
        audio_format = AudioFormat.from_extension(f".{revision.file_type}")
        audio_blob = {
            "$type": "blob",
            "ref": {"$link": revision.pds_blob_cid},
            "mimeType": audio_format.media_type if audio_format else "audio/mpeg",
            "size": revision.pds_blob_size or 0,
        }

    new_record = build_track_record(
        title=track.title,
        artist=track.artist.display_name,
        audio_url=_audio_url_for_record(revision),
        file_type=revision.file_type,
        album=track.album,
        duration=revision.duration,
        features=list(track.features) if track.features else None,
        image_url=await track.get_image_url(),
        support_gate=dict(track.support_gate) if track.support_gate else None,
        audio_blob=audio_blob,
        description=track.description,
    )
    try:
        _, new_cid = await update_record(
            auth_session=auth_session,
            record_uri=track.atproto_record_uri,
            record=new_record,
        )
    except Exception as exc:
        logfire.exception(
            "restore: failed to update ATProto record",
            track_id=track_id,
            revision_id=revision_id,
        )
        raise HTTPException(
            status_code=502,
            detail=f"failed to publish restored record: {exc}",
        ) from exc

    # commit: snapshot current → update track → delete chosen revision.
    # all in one transaction so we never end up with a track pointing at a
    # blob no row owns.
    async with db_session() as db:
        live_track = await db.get(Track, track_id)
        if not live_track:
            raise HTTPException(status_code=404, detail="track not found")

        snapshot = TrackRevision(
            track_id=live_track.id,
            file_id=live_track.file_id,
            file_type=live_track.file_type,
            original_file_id=live_track.original_file_id,
            original_file_type=live_track.original_file_type,
            audio_storage=live_track.audio_storage,
            audio_url=live_track.r2_url,
            pds_blob_cid=live_track.pds_blob_cid,
            pds_blob_size=live_track.pds_blob_size,
            duration=live_track.duration,
            was_gated=live_track.support_gate is not None,
        )
        db.add(snapshot)

        live_track.file_id = revision.file_id
        live_track.file_type = revision.file_type
        live_track.original_file_id = revision.original_file_id
        live_track.original_file_type = revision.original_file_type
        live_track.audio_storage = revision.audio_storage
        live_track.r2_url = revision.audio_url
        live_track.pds_blob_cid = revision.pds_blob_cid
        live_track.pds_blob_size = revision.pds_blob_size
        live_track.atproto_record_cid = new_cid

        # update duration in extra; clear stale genre-prediction provenance so
        # a future re-classification doesn't get short-circuited.
        extra = dict(live_track.extra) if live_track.extra else {}
        if revision.duration is not None:
            extra["duration"] = revision.duration
        else:
            extra.pop("duration", None)
        extra.pop("genre_predictions", None)
        extra.pop("genre_predictions_file_id", None)
        live_track.extra = extra

        # delete the chosen revision row — its content is now the live audio,
        # and keeping it would duplicate the track row's pointer.
        chosen = await db.get(TrackRevision, revision_id)
        if chosen:
            await db.delete(chosen)

        await db.commit()

    # post-commit best-effort:
    # - prune revisions if the snapshot pushed us over the cap
    # - resync album list record so its strongRef carries the new CID
    await prune_revisions(track_id)

    if track.album_id:
        from backend._internal.tasks import schedule_album_list_sync

        try:
            await schedule_album_list_sync(auth_session.session_id, track.album_id)
            async with db_session() as db:
                await invalidate_album_cache_by_id(db, track.album_id)
        except Exception:
            logger.exception(
                "restore: album list resync failed (track restored; album "
                "record's strongRef may carry a stale CID until next edit)",
            )

    return RevisionResponse.from_revision(snapshot)
