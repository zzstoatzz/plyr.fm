#!/usr/bin/env -S uv run --script --quiet
"""backfill verified R2 copies for tracks whose audio lives only on a PDS.

## Context

Tracks ingested from the firehose can have no audio object of ours: the bytes
are a blob on the artist's PDS, and `resolve_audio_url` built a `getBlob` URL
that we handed to AudD, Modal, and Replicate. A PDS serves its blobs fresh on
every request, so scanning that URL scanned whatever the operator felt like
returning at that moment (#1778).

`mirror_pds_blob` fixes this going forward, but it only runs from the
post-create hooks — a track ingested months ago never fires those again. This
walks the existing rows.

Each track is fetched once, checked against the `pds_blob_cid` its record
commits to, and stored only if the bytes match. A mismatch is reported and
skipped, never stored.

## Usage

```bash
# what would be mirrored, including a HEAD-only reachability check
uv run --project backend scripts/backfill_pds_blob_mirror.py --dry-run

# mirror a single track first
uv run --project backend scripts/backfill_pds_blob_mirror.py --limit 1

# the rest
uv run --project backend scripts/backfill_pds_blob_mirror.py
```
"""

import argparse
import asyncio
import logging

from atproto_oauth.security import get_hardened_async_client, is_safe_url
from sqlalchemy import select

from backend._internal.atproto.client import pds_blob_url
from backend._internal.tasks.pds_mirror import BlobVerificationError, mirror_pds_blob
from backend.models import Artist, Track
from backend.utilities.database import db_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def _candidates(limit: int | None) -> list[tuple[int, str, str, str, str]]:
    """tracks with a PDS blob and no audio object of ours."""
    async with db_session() as db:
        query = (
            select(
                Track.id,
                Track.title,
                Track.pds_blob_cid,
                Track.artist_did,
                Artist.pds_url,
            )
            .join(Artist, Artist.did == Track.artist_did)
            .where(
                Track.r2_url.is_(None),
                Track.pds_blob_cid.isnot(None),
            )
            .order_by(Track.id)
        )
        if limit:
            query = query.limit(limit)
        return list((await db.execute(query)).all())


async def _report(track_id: int, title: str, cid: str, did: str, pds: str) -> None:
    """describe one candidate without fetching its bytes."""
    if not pds:
        logger.warning("track %s (%r): artist has no pds_url", track_id, title)
        return
    if not is_safe_url(pds):
        logger.warning("track %s (%r): unsafe pds_url %s", track_id, title, pds)
        return

    url = pds_blob_url(pds, did, cid)
    try:
        async with get_hardened_async_client() as client:
            response = await client.head(url)
        size = response.headers.get("content-length", "unknown")
        logger.info(
            "track %s (%r): %s -> HTTP %s, %s bytes",
            track_id,
            title,
            pds,
            response.status_code,
            size,
        )
    except Exception as exc:
        logger.warning("track %s (%r): HEAD failed: %s", track_id, title, exc)


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report only")
    parser.add_argument("--limit", type=int, help="process at most N tracks")
    args = parser.parse_args()

    candidates = await _candidates(args.limit)
    logger.info("found %d track(s) with PDS-only audio", len(candidates))
    if not candidates:
        return

    mirrored = skipped = failed = 0
    for track_id, title, cid, did, pds in candidates:
        if args.dry_run:
            await _report(track_id, title, cid, did, pds)
            continue

        try:
            await mirror_pds_blob(track_id)
        except BlobVerificationError as exc:
            # the PDS served bytes its own record does not commit to
            logger.error("track %s (%r): VERIFICATION FAILED: %s", track_id, title, exc)
            failed += 1
            continue
        except Exception as exc:
            logger.error("track %s (%r): %s", track_id, title, exc)
            failed += 1
            continue

        async with db_session() as db:
            stored = await db.scalar(select(Track.r2_url).where(Track.id == track_id))
        if stored:
            logger.info("track %s (%r): mirrored -> %s", track_id, title, stored)
            mirrored += 1
        else:
            # unreachable blob, oversized blob, or unsupported file type --
            # mirror_pds_blob logs the specific reason
            logger.warning("track %s (%r): not mirrored", track_id, title)
            skipped += 1

    if not args.dry_run:
        logger.info(
            "done: %d mirrored, %d skipped, %d failed", mirrored, skipped, failed
        )


if __name__ == "__main__":
    asyncio.run(main())
