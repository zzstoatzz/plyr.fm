#!/usr/bin/env -S uv run --script --quiet
"""backfill CLAP embeddings for existing tracks.

## Context

Mood search uses CLAP embeddings stored in turbopuffer to match text
descriptions to audio content. New uploads generate embeddings automatically,
but existing tracks need to be backfilled.

## What This Script Does

1. Queries all tracks with an R2 audio URL
2. Downloads each track's audio from R2
3. Generates a CLAP embedding via Modal
4. Upserts the embedding into turbopuffer

## Usage

```bash
# dry run (show what would be embedded, no API calls)
uv run scripts/backfill_embeddings.py --dry-run

# embed first 5 tracks
uv run scripts/backfill_embeddings.py --limit 5

# full backfill with 10 concurrent workers (default)
uv run scripts/backfill_embeddings.py

# custom concurrency
uv run scripts/backfill_embeddings.py --concurrency 20
```
"""

import argparse
import asyncio
import logging
import time

import httpx
from sqlalchemy import select

from backend._internal.clients.clap import get_clap_client
from backend._internal.clients.tpuf import upsert
from backend.config import settings
from backend.models import Artist, Track
from backend.utilities.database import db_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def _embed_one(
    track: Track,
    artist: Artist,
    http: httpx.AsyncClient,
    clap_client: object,
    sem: asyncio.Semaphore,
    counter: dict[str, int],
    total: int,
) -> None:
    """embed a single track, guarded by semaphore."""
    async with sem:
        r2_url = f"{settings.storage.r2_public_bucket_url}/audio/{track.file_id}.{track.file_type}"
        idx = counter["started"] + 1
        counter["started"] += 1

        try:
            logger.info(
                "embedding [%d/%d] track %d: %s", idx, total, track.id, track.title
            )

            resp = await http.get(r2_url)
            resp.raise_for_status()
            audio_bytes = resp.content

            embed_result = await clap_client.embed_audio(audio_bytes)

            if not embed_result.success or not embed_result.embedding:
                logger.warning(
                    "embedding failed for track %d: %s", track.id, embed_result.error
                )
                counter["failed"] += 1
                return

            await upsert(
                track_id=track.id,
                embedding=embed_result.embedding,
                title=track.title,
                artist_handle=artist.handle,
                artist_did=artist.did,
            )

            counter["embedded"] += 1
            logger.info(
                "embedded track %d (%d dims)", track.id, embed_result.dimensions
            )

        except Exception:
            logger.exception("failed to process track %d", track.id)
            counter["failed"] += 1


async def backfill_embeddings(
    dry_run: bool = False,
    limit: int | None = None,
    concurrency: int = 10,
) -> None:
    """backfill CLAP embeddings for tracks missing from turbopuffer."""

    if not dry_run:
        if not settings.modal.enabled:
            logger.error("MODAL_ENABLED is not set — cannot generate embeddings")
            return
        if not settings.turbopuffer.enabled:
            logger.error("TURBOPUFFER_ENABLED is not set — cannot store embeddings")
            return

    async with db_session() as db:
        stmt = (
            select(Track, Artist)
            .join(Artist, Track.artist_did == Artist.did)
            .where(Track.file_id.isnot(None))
            .order_by(Track.id)
        )
        if limit:
            stmt = stmt.limit(limit)

        result = await db.execute(stmt)
        rows = result.all()

    if not rows:
        logger.info("no tracks found to embed")
        return

    logger.info("found %d tracks to process (concurrency=%d)", len(rows), concurrency)

    if dry_run:
        for track, artist in rows:
            logger.info(
                "would embed: [%d] %s by %s",
                track.id,
                track.title,
                artist.handle,
            )
        return

    clap_client = get_clap_client()
    sem = asyncio.Semaphore(concurrency)
    counter: dict[str, int] = {"started": 0, "embedded": 0, "failed": 0}
    t0 = time.monotonic()

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as http:
        tasks = [
            _embed_one(track, artist, http, clap_client, sem, counter, len(rows))
            for track, artist in rows
        ]
        await asyncio.gather(*tasks)

    elapsed = time.monotonic() - t0
    logger.info(
        "backfill complete: %d embedded, %d failed, %d total in %.0fs (%.1f tracks/s)",
        counter["embedded"],
        counter["failed"],
        len(rows),
        elapsed,
        len(rows) / elapsed if elapsed > 0 else 0,
    )


async def main() -> None:
    parser = argparse.ArgumentParser(description="backfill CLAP embeddings")
    parser.add_argument(
        "--dry-run", action="store_true", help="show what would be done"
    )
    parser.add_argument("--limit", type=int, default=None, help="max tracks to process")
    parser.add_argument(
        "--concurrency", type=int, default=10, help="concurrent workers"
    )
    args = parser.parse_args()

    if args.dry_run:
        logger.info("running in DRY RUN mode — no API calls will be made")

    await backfill_embeddings(
        dry_run=args.dry_run,
        limit=args.limit,
        concurrency=args.concurrency,
    )


if __name__ == "__main__":
    asyncio.run(main())
