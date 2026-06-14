#!/usr/bin/env -S uv run --script --quiet
"""audit (read-only) m4a tracks for the ALAC codec.

## Context

An `.m4a` extension was assumed to mean AAC (browser-playable), so ALAC-in-m4a
uploads were published with the raw file as their only rendition. Chromium has
no ALAC decoder, so `<audio>` fires MEDIA_ERR_SRC_NOT_SUPPORTED and the track is
silently unplayable (it also stalled the deep-cuts radio station — issue #1595).

New uploads now detect ALAC and schedule a transcode automatically
(`uploads.is_alac` → deferred `optimize_track_audio`). This script only *reports*
which existing m4a tracks are ALAC; it does NOT touch them. Remediating an
existing track means re-encoding it and rewriting the owner's PDS record, which
is the owner's data — it must happen through the owner's own action (a re-upload
/ audio-replace), never a unilateral sweep on a stored session.

## Usage

```bash
uv run scripts/audit_alac_m4a.py
```
"""

import argparse
import asyncio
import logging

from sqlalchemy import select

from backend.models import Track
from backend.storage import storage
from backend.utilities.audio import is_alac
from backend.utilities.database import db_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def _m4a_tracks(track_id: int | None) -> list[Track]:
    """m4a tracks that still serve the raw upload (never optimized)."""
    async with db_session() as db:
        stmt = select(Track).where(
            Track.file_type == "m4a",
            Track.original_file_id.is_(None),
        )
        if track_id is not None:
            stmt = stmt.where(Track.id == track_id)
        return list((await db.execute(stmt)).scalars().all())


async def main(track_id: int | None) -> None:
    tracks = await _m4a_tracks(track_id)
    logger.info("inspecting %d m4a track(s)", len(tracks))

    alac: list[Track] = []
    for track in tracks:
        data = await storage.get_file_data(track.file_id, "m4a")
        if data is None:
            logger.warning(
                "track %s (%s): could not read audio bytes", track.id, track.title
            )
            continue
        if is_alac(data):
            alac.append(track)
            logger.info("track %s (%s): ALAC", track.id, track.title)

    logger.info("found %d ALAC m4a track(s): %s", len(alac), [t.id for t in alac])
    if alac:
        logger.info(
            "these are unplayable in chromium. remediation (re-encode + PDS "
            "record rewrite) is the owner's data and must come from the owner's "
            "own re-upload / audio-replace — not from this tool."
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--track-id", type=int, default=None, help="limit to a single track id"
    )
    args = parser.parse_args()
    asyncio.run(main(args.track_id))
