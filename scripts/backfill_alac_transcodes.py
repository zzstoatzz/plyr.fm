#!/usr/bin/env -S uv run --script --quiet
"""audit + remediate ALAC-in-m4a tracks that predate ALAC detection at upload.

## Context

An `.m4a` extension was assumed to mean AAC (browser-playable), so ALAC-in-m4a
uploads were published with the raw file as their only rendition. Chromium has
no ALAC decoder, so `<audio>` fires MEDIA_ERR_SRC_NOT_SUPPORTED and the track is
silently unplayable (it also stalled the deep-cuts radio station — issue #1595).

New uploads now detect ALAC and schedule a transcode automatically
(`uploads.is_alac` → deferred `optimize_track_audio`). This script remediates the
pre-existing tracks: it finds m4a tracks that were never optimized, downloads the
bytes, checks for the `alac` codec, and — for the real ALAC ones — points
`original_file_id` at the raw m4a and enqueues `optimize_track_audio`, which
produces the MP3 streaming rendition and rewrites the PDS record.

Enqueuing the optimize task needs a live session for the track owner (to rewrite
their PDS record). Owners with no current session are reported and skipped — they
self-heal on the owner's next sign-in if re-run, or via an audio replace.

## Usage

```bash
# audit only (default): list ALAC m4a tracks and whether each is remediable
uv run scripts/backfill_alac_transcodes.py

# remediate: set original pointer + enqueue optimize for each ALAC track
uv run scripts/backfill_alac_transcodes.py --apply

# limit scope (e.g. just track 732)
uv run scripts/backfill_alac_transcodes.py --track-id 732 --apply
```
"""

import argparse
import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy import update as sa_update

from backend.api.tracks.audio_optimize import schedule_optimize_track_audio
from backend.models import Track
from backend.models.session import UserSession
from backend.storage import storage
from backend.utilities.audio import is_alac
from backend.utilities.database import db_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def _live_session_id(did: str) -> str | None:
    """return a non-expired session_id for the track owner, or None."""
    async with db_session() as db:
        rows = (
            await db.execute(
                select(UserSession.session_id, UserSession.expires_at).where(
                    UserSession.did == did
                )
            )
        ).all()
    now = datetime.now(UTC)
    for session_id, expires_at in rows:
        if expires_at is None or expires_at > now:
            return session_id
    return None


async def _candidate_tracks(track_id: int | None) -> list[Track]:
    """m4a tracks that still serve the raw upload (never optimized)."""
    async with db_session() as db:
        stmt = select(Track).where(
            Track.file_type == "m4a",
            Track.original_file_id.is_(None),
        )
        if track_id is not None:
            stmt = stmt.where(Track.id == track_id)
        return list((await db.execute(stmt)).scalars().all())


async def _remediate(track: Track) -> None:
    """point original_file_id at the raw m4a and enqueue the optimize task."""
    session_id = await _live_session_id(track.artist_did)
    if session_id is None:
        logger.warning(
            "track %s (%s): ALAC but no live session for %s — skipped "
            "(owner must sign in, then re-run)",
            track.id,
            track.title,
            track.artist_did,
        )
        return

    async with db_session() as db:
        await db.execute(
            sa_update(Track)
            .where(Track.id == track.id)
            .values(original_file_id=track.file_id, original_file_type="m4a")
        )
        await db.commit()
    await schedule_optimize_track_audio(track.id, session_id)
    logger.info("track %s (%s): enqueued optimize", track.id, track.title)


async def main(track_id: int | None, apply: bool) -> None:
    tracks = await _candidate_tracks(track_id)
    logger.info("inspecting %d m4a track(s)", len(tracks))

    alac: list[Track] = []
    for track in tracks:
        data = await storage.get_file_data(track.file_id, "m4a")
        if data is None:
            logger.warning(
                "track %s (%s): could not read audio bytes — skipped",
                track.id,
                track.title,
            )
            continue
        if is_alac(data):
            alac.append(track)
            logger.info("track %s (%s): ALAC", track.id, track.title)

    logger.info("found %d ALAC m4a track(s)", len(alac))
    if not apply:
        logger.info("audit only; pass --apply to remediate")
        return

    for track in alac:
        await _remediate(track)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--track-id", type=int, default=None, help="limit to a single track id"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="remediate (default is audit-only)",
    )
    args = parser.parse_args()
    asyncio.run(main(args.track_id, args.apply))
