#!/usr/bin/env -S uv run --script --quiet
"""backfill thumbnails for existing track/album/playlist images.

## Context

Track artwork and avatars display at 48px but full-resolution images are
served. This generates 96x96 WebP thumbnails (2x retina) and stores them
alongside the originals in R2.

## Usage

```bash
# dry run (show what would be thumbnailed)
uv run scripts/backfill_thumbnails.py --dry-run

# generate first 5 thumbnails
uv run scripts/backfill_thumbnails.py --limit 5

# full backfill with custom concurrency
uv run scripts/backfill_thumbnails.py --concurrency 20
```
"""

import argparse
import asyncio
import logging
import time

import httpx
from sqlalchemy import select, update

from backend._internal.thumbnails import generate_thumbnail
from backend.models import Album, Track
from backend.models.playlist import Playlist
from backend.storage import storage
from backend.utilities.database import db_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def _process_one(
    row: dict,
    http: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    counter: dict[str, int],
    total: int,
) -> None:
    """download original image, generate thumbnail, upload and update DB."""
    async with sem:
        idx = counter["started"] + 1
        counter["started"] += 1

        try:
            logger.info(
                "thumbnailing [%d/%d] %s %s: %s",
                idx,
                total,
                row["table"],
                row["id"],
                row["image_url"],
            )

            resp = await http.get(row["image_url"])
            resp.raise_for_status()

            thumb_data = generate_thumbnail(resp.content)
            thumbnail_url = await storage.save_thumbnail(thumb_data, row["image_id"])

            # update DB row
            async with db_session() as db:
                await db.execute(
                    update(row["model"])
                    .where(row["model"].id == row["id"])
                    .values(thumbnail_url=thumbnail_url)
                )
                await db.commit()

            counter["generated"] += 1
            logger.info(
                "generated thumbnail for %s %s (%d bytes)",
                row["table"],
                row["id"],
                len(thumb_data),
            )

        except Exception:
            logger.exception("failed to thumbnail %s %s", row["table"], row["id"])
            counter["failed"] += 1


async def backfill_thumbnails(
    dry_run: bool = False,
    limit: int | None = None,
    concurrency: int = 10,
) -> None:
    """backfill thumbnails for images missing thumbnail_url."""

    rows: list[dict] = []

    async with db_session() as db:
        # tracks with images but no thumbnail
        stmt = (
            select(Track)
            .where(Track.image_id.isnot(None), Track.thumbnail_url.is_(None))
            .order_by(Track.id)
        )
        if limit:
            stmt = stmt.limit(limit)
        result = await db.execute(stmt)
        for track in result.scalars():
            if track.image_url:
                rows.append(
                    {
                        "table": "track",
                        "id": track.id,
                        "image_id": track.image_id,
                        "image_url": track.image_url,
                        "model": Track,
                    }
                )

        # albums with images but no thumbnail
        remaining = (limit - len(rows)) if limit else None
        if remaining is None or remaining > 0:
            stmt = (
                select(Album)
                .where(Album.image_id.isnot(None), Album.thumbnail_url.is_(None))
                .order_by(Album.id)
            )
            if remaining:
                stmt = stmt.limit(remaining)
            result = await db.execute(stmt)
            for album in result.scalars():
                if album.image_url:
                    rows.append(
                        {
                            "table": "album",
                            "id": album.id,
                            "image_id": album.image_id,
                            "image_url": album.image_url,
                            "model": Album,
                        }
                    )

        # playlists with images but no thumbnail
        remaining = (limit - len(rows)) if limit else None
        if remaining is None or remaining > 0:
            stmt = (
                select(Playlist)
                .where(Playlist.image_id.isnot(None), Playlist.thumbnail_url.is_(None))
                .order_by(Playlist.id)
            )
            if remaining:
                stmt = stmt.limit(remaining)
            result = await db.execute(stmt)
            for playlist in result.scalars():
                if playlist.image_url:
                    rows.append(
                        {
                            "table": "playlist",
                            "id": playlist.id,
                            "image_id": playlist.image_id,
                            "image_url": playlist.image_url,
                            "model": Playlist,
                        }
                    )

    if not rows:
        logger.info("no images found needing thumbnails")
        return

    logger.info("found %d images to thumbnail (concurrency=%d)", len(rows), concurrency)

    if dry_run:
        for row in rows:
            logger.info(
                "would thumbnail: %s %s (image_id=%s)",
                row["table"],
                row["id"],
                row["image_id"],
            )
        return

    sem = asyncio.Semaphore(concurrency)
    counter: dict[str, int] = {"started": 0, "generated": 0, "failed": 0}
    t0 = time.monotonic()

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as http:
        tasks = [_process_one(row, http, sem, counter, len(rows)) for row in rows]
        await asyncio.gather(*tasks)

    elapsed = time.monotonic() - t0
    logger.info(
        "backfill complete: %d generated, %d failed, %d total in %.0fs (%.1f/s)",
        counter["generated"],
        counter["failed"],
        len(rows),
        elapsed,
        len(rows) / elapsed if elapsed > 0 else 0,
    )


async def main() -> None:
    parser = argparse.ArgumentParser(description="backfill image thumbnails")
    parser.add_argument(
        "--dry-run", action="store_true", help="show what would be done"
    )
    parser.add_argument("--limit", type=int, default=None, help="max images to process")
    parser.add_argument(
        "--concurrency", type=int, default=10, help="concurrent workers"
    )
    args = parser.parse_args()

    if args.dry_run:
        logger.info("running in DRY RUN mode — no uploads will be made")

    await backfill_thumbnails(
        dry_run=args.dry_run,
        limit=args.limit,
        concurrency=args.concurrency,
    )


if __name__ == "__main__":
    asyncio.run(main())
