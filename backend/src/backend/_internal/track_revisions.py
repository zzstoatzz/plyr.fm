"""helpers for managing per-track audio revision history.

revisions are written by the audio replace and audio restore endpoints — each
captures the audio state that's about to be displaced. this module owns the
retention policy: keep at most `MAX_REVISIONS_PER_TRACK` per track, and when
pruning, delete the backing blob if no other revision (or the track itself)
still references it.

prune is best-effort and runs OUTSIDE the swap transaction. a failure to
prune leaves the row in place — worst case a track has more revisions than
the cap, never silently corrupts the live audio pointer.
"""

import logging

from sqlalchemy import select

from backend.models import MAX_REVISIONS_PER_TRACK, Track, TrackRevision
from backend.storage import storage
from backend.utilities.database import db_session

logger = logging.getLogger(__name__)


async def prune_revisions(track_id: int) -> None:
    """drop oldest revisions beyond `MAX_REVISIONS_PER_TRACK`, freeing blobs.

    runs in its own short transaction. exceptions are logged but never
    re-raised — pruning failure must not corrupt the swap that just succeeded.
    """
    try:
        async with db_session() as db:
            result = await db.execute(
                select(TrackRevision)
                .where(TrackRevision.track_id == track_id)
                .order_by(TrackRevision.created_at.asc(), TrackRevision.id.asc())
            )
            revisions = list(result.scalars())

            excess = len(revisions) - MAX_REVISIONS_PER_TRACK
            if excess <= 0:
                return

            to_prune = revisions[:excess]
            keepers = revisions[excess:]

            # collect file_ids still in use by the live track + the revisions
            # we're keeping, so we don't delete a blob another row depends on
            # (e.g. user restored to an old version, so track and an older
            # revision share a file_id)
            track = await db.get(Track, track_id)
            in_use_file_ids: set[str] = set()
            in_use_original_file_ids: set[str] = set()
            if track:
                in_use_file_ids.add(track.file_id)
                if track.original_file_id:
                    in_use_original_file_ids.add(track.original_file_id)
            for keeper in keepers:
                in_use_file_ids.add(keeper.file_id)
                if keeper.original_file_id:
                    in_use_original_file_ids.add(keeper.original_file_id)

            for revision in to_prune:
                await _maybe_delete_blob(
                    revision, in_use_file_ids, in_use_original_file_ids
                )
                await db.delete(revision)

            await db.commit()
    except Exception:
        logger.exception(
            "prune_revisions failed for track_id=%s (revisions may exceed the "
            "retention cap until the next prune)",
            track_id,
        )


async def _maybe_delete_blob(
    revision: TrackRevision,
    in_use_file_ids: set[str],
    in_use_original_file_ids: set[str],
) -> None:
    """delete blobs owned by us if no live row still references them.

    PDS-only audio (audio_storage="pds") lives on the user's PDS — we never
    delete those. for "r2" or "both" audio, the playable file is in our
    storage and we own it. transcode originals always live in the public
    bucket regardless of gating (gated tracks can't be lossless yet).
    """
    if revision.audio_storage == "pds":
        return  # not ours to delete

    # primary playable file: routed to gated bucket if it was gated at the time
    if revision.file_id and revision.file_id not in in_use_file_ids:
        delete_fn = storage.delete_gated if revision.was_gated else storage.delete
        try:
            await delete_fn(revision.file_id, revision.file_type)
        except Exception:
            logger.exception(
                "failed to delete pruned revision blob (file_id=%s, gated=%s)",
                revision.file_id,
                revision.was_gated,
            )

    # transcode original: always public bucket
    if (
        revision.original_file_id
        and revision.original_file_id not in in_use_original_file_ids
    ):
        try:
            await storage.delete(revision.original_file_id, revision.original_file_type)
        except Exception:
            logger.exception(
                "failed to delete pruned revision original (file_id=%s)",
                revision.original_file_id,
            )
