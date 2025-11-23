#!/usr/bin/env -S uv run --script --quiet
"""backfill image_url for tracks with image_id but missing image_url.

## Context

PR #184 added image_url column to tracks table to eliminate N+1 R2 API calls.
New uploads automatically populate image_url at creation time, but 15 legacy
tracks uploaded before the PR still have image_url = NULL.

This causes slow /tracks/liked endpoint performance because we fall back to
calling track.get_image_url() which hits R2 API on every request.

## What This Script Does

1. Finds all tracks with image_id but NULL image_url
2. Computes image_url by calling storage.get_url(image_id)
3. Updates database with computed URLs
4. Runs concurrently for performance

## Usage

```bash
# dry run (show what would be updated)
uv run scripts/backfill_image_urls.py --dry-run

# actually update the database
uv run scripts/backfill_image_urls.py

# target specific environment
DATABASE_URL=postgresql://... uv run scripts/backfill_image_urls.py
```
"""

import asyncio
import logging
import sys
from pathlib import Path

# add src to path so we can import backend modules
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from sqlalchemy import select

from backend.config import settings
from backend.models import Track
from backend.storage import storage
from backend.storage.r2 import R2Storage
from backend.utilities.database import db_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def backfill_image_urls(dry_run: bool = False) -> None:
    """backfill image_url for tracks with image_id but missing image_url."""

    if not isinstance(storage, R2Storage):
        logger.error("storage backend is not R2, cannot compute image URLs")
        return

    logger.info(f"storage backend: {settings.storage.backend}")

    async with db_session() as db:
        # find tracks with image_id but no image_url
        stmt = select(Track).where(
            Track.image_id.isnot(None), Track.image_url.is_(None)
        )
        result = await db.execute(stmt)
        tracks = result.scalars().all()

        if not tracks:
            logger.info("no tracks need backfilling")
            return

        logger.info(f"found {len(tracks)} tracks needing image_url backfill")

        if dry_run:
            logger.info("dry run mode - showing tracks that would be updated:")
            for track in tracks:
                logger.info(
                    f"  track {track.id}: {track.title} (image_id: {track.image_id})"
                )
            return

        # compute image URLs concurrently
        logger.info("computing image URLs from R2...")

        async def compute_and_update(
            track: Track,
        ) -> tuple[int, str | None, Exception | None]:
            """compute image_url for a track and return (track_id, url, error)."""
            try:
                url = await storage.get_url(track.image_id, file_type="image")
                return (track.id, url, None)
            except Exception as e:
                return (track.id, None, e)

        results = await asyncio.gather(*[compute_and_update(t) for t in tracks])

        # update database with computed URLs
        updated = 0
        failed = 0

        for track_id, image_url, error in results:
            if image_url:
                # find the track object
                track = next(t for t in tracks if t.id == track_id)
                track.image_url = image_url
                updated += 1
                logger.info(f"updated track {track_id}: {track.title}")
            else:
                failed += 1
                track = next(t for t in tracks if t.id == track_id)
                logger.error(
                    f"failed to compute URL for track {track_id} ({track.title}): {error}"
                )

        await db.commit()

        logger.info(f"backfill complete: {updated} updated, {failed} failed")


async def main() -> None:
    """main entry point."""
    dry_run = "--dry-run" in sys.argv

    if dry_run:
        logger.info("running in DRY RUN mode - no changes will be made")

    await backfill_image_urls(dry_run=dry_run)


if __name__ == "__main__":
    asyncio.run(main())
