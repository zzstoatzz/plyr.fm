#!/usr/bin/env -S uv run --script --quiet
"""backfill genre classifications for existing tracks.

## Context

Genre classification uses the effnet-discogs model on Replicate to classify
audio into genre labels. New uploads classify automatically, but existing
tracks need to be backfilled.

## What This Script Does

1. Queries all tracks with an R2 audio URL missing genre_predictions in extra
2. Classifies each track via Replicate
3. Stores predictions in track.extra["genre_predictions"]

## Usage

```bash
# dry run (show what would be classified, no API calls)
uv run scripts/backfill_genres.py --dry-run

# classify first 5 tracks
uv run scripts/backfill_genres.py --limit 5

# full backfill with 5 concurrent workers (default)
uv run scripts/backfill_genres.py

# custom concurrency
uv run scripts/backfill_genres.py --concurrency 10
```
"""

import argparse
import asyncio
import logging
import time

from sqlalchemy import select, text

from backend._internal.replicate_client import get_replicate_client
from backend.config import settings
from backend.models import Artist, Track
from backend.utilities.database import db_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def _classify_one(
    track: Track,
    artist: Artist,
    client: object,
    sem: asyncio.Semaphore,
    counter: dict[str, int],
    total: int,
) -> None:
    """classify a single track, guarded by semaphore."""
    async with sem:
        idx = counter["started"] + 1
        counter["started"] += 1

        try:
            logger.info(
                "classifying [%d/%d] track %d: %s by %s",
                idx,
                total,
                track.id,
                track.title,
                artist.handle,
            )

            result = await client.classify(track.r2_url)

            if not result.success or not result.genres:
                logger.warning(
                    "classification failed for track %d: %s",
                    track.id,
                    result.error,
                )
                counter["failed"] += 1
                return

            predictions = [
                {"name": g.name, "confidence": g.confidence} for g in result.genres
            ]

            async with db_session() as db:
                db_result = await db.execute(select(Track).where(Track.id == track.id))
                db_track = db_result.scalar_one_or_none()
                if db_track:
                    extra = dict(db_track.extra) if db_track.extra else {}
                    extra["genre_predictions"] = predictions
                    extra["genre_predictions_file_id"] = db_track.file_id
                    db_track.extra = extra
                    await db.commit()

            counter["classified"] += 1
            logger.info(
                "classified track %d: top genre = %s (%.2f)",
                track.id,
                predictions[0]["name"],
                predictions[0]["confidence"],
            )

        except Exception:
            logger.exception("failed to process track %d", track.id)
            counter["failed"] += 1


async def backfill_genres(
    dry_run: bool = False,
    limit: int | None = None,
    concurrency: int = 5,
) -> None:
    """backfill genre classifications for tracks missing predictions."""

    if not dry_run:
        if not settings.replicate.enabled:
            logger.error("REPLICATE_ENABLED is not set — cannot classify genres")
            return

    async with db_session() as db:
        stmt = (
            select(Track, Artist)
            .join(Artist, Track.artist_did == Artist.did)
            .where(
                Track.r2_url.isnot(None),
                # filter tracks missing genre_predictions in extra
                text("NOT (tracks.extra ? 'genre_predictions')"),
            )
            .order_by(Track.id)
        )
        if limit:
            stmt = stmt.limit(limit)

        result = await db.execute(stmt)
        rows = result.all()

    if not rows:
        logger.info("no tracks found to classify")
        return

    logger.info("found %d tracks to classify (concurrency=%d)", len(rows), concurrency)

    if dry_run:
        for track, artist in rows:
            logger.info(
                "would classify: [%d] %s by %s",
                track.id,
                track.title,
                artist.handle,
            )
        return

    client = get_replicate_client()
    sem = asyncio.Semaphore(concurrency)
    counter: dict[str, int] = {"started": 0, "classified": 0, "failed": 0}
    t0 = time.monotonic()

    tasks = [
        _classify_one(track, artist, client, sem, counter, len(rows))
        for track, artist in rows
    ]
    await asyncio.gather(*tasks)

    elapsed = time.monotonic() - t0
    logger.info(
        "backfill complete: %d classified, %d failed, %d total in %.0fs (%.1f tracks/s)",
        counter["classified"],
        counter["failed"],
        len(rows),
        elapsed,
        len(rows) / elapsed if elapsed > 0 else 0,
    )


async def main() -> None:
    parser = argparse.ArgumentParser(description="backfill genre classifications")
    parser.add_argument(
        "--dry-run", action="store_true", help="show what would be done"
    )
    parser.add_argument("--limit", type=int, default=None, help="max tracks to process")
    parser.add_argument("--concurrency", type=int, default=5, help="concurrent workers")
    args = parser.parse_args()

    if args.dry_run:
        logger.info("running in DRY RUN mode — no API calls will be made")

    await backfill_genres(
        dry_run=args.dry_run,
        limit=args.limit,
        concurrency=args.concurrency,
    )


if __name__ == "__main__":
    asyncio.run(main())
