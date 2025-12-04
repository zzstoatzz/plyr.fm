#!/usr/bin/env -S uv run --script --quiet
"""backfill duration for tracks missing it.

## Context

Tracks uploaded before duration extraction was implemented have NULL duration.
This affects teal.fm scrobbles which should include duration metadata.

## What This Script Does

1. Finds all tracks with NULL duration in extra
2. Downloads audio files from R2 concurrently (semaphore-limited)
3. Extracts duration using mutagen
4. Updates database with extracted durations

## Usage

```bash
# dry run (show what would be updated)
uv run scripts/backfill_duration.py --dry-run

# actually update the database
uv run scripts/backfill_duration.py

# limit concurrency (default: 10)
uv run scripts/backfill_duration.py --concurrency 5

# target specific environment
DATABASE_URL=postgresql://... uv run scripts/backfill_duration.py
```

Run in order: dev → staging → prod
"""

import asyncio
import io
import logging
import sys
from pathlib import Path

import httpx
from mutagen import File as MutagenFile

# add src to path so we can import backend modules
sys.path.insert(0, str(Path(__file__).parent.parent / "backend" / "src"))

from sqlalchemy import select, update

from backend.models import Track
from backend.utilities.database import db_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def extract_duration_from_bytes(audio_data: bytes) -> int | None:
    """extract duration from audio bytes."""
    try:
        audio = MutagenFile(io.BytesIO(audio_data))
        if audio is None or audio.info is None:
            return None
        length = getattr(audio.info, "length", None)
        return int(length) if length else None
    except Exception as e:
        logger.warning(f"mutagen error: {e}")
        return None


async def fetch_and_extract(
    client: httpx.AsyncClient,
    track: Track,
    semaphore: asyncio.Semaphore,
) -> tuple[int, int | None, str | None]:
    """fetch audio from R2 and extract duration.

    returns: (track_id, duration, error)
    """
    async with semaphore:
        if not track.r2_url:
            return (track.id, None, "no r2_url")

        try:
            logger.info(f"fetching track {track.id}: {track.title[:40]}...")
            response = await client.get(track.r2_url, follow_redirects=True)
            response.raise_for_status()

            duration = extract_duration_from_bytes(response.content)
            if duration:
                logger.info(f"  → {duration}s")
                return (track.id, duration, None)
            else:
                return (track.id, None, "could not extract duration")

        except httpx.HTTPStatusError as e:
            return (track.id, None, f"HTTP {e.response.status_code}")
        except Exception as e:
            return (track.id, None, str(e))


async def fetch_and_extract_simple(
    client: httpx.AsyncClient,
    track_id: int,
    title: str,
    r2_url: str | None,
    semaphore: asyncio.Semaphore,
) -> tuple[int, int | None, str | None]:
    """fetch audio header from R2 and extract duration.

    uses Range request to fetch only first 256KB (enough for metadata).
    falls back to full download if range request fails or duration not found.

    returns: (track_id, duration, error)
    """
    async with semaphore:
        if not r2_url:
            return (track_id, None, "no r2_url")

        try:
            logger.info(f"fetching track {track_id}: {title[:40]}...")

            # try range request first (256KB should be enough for most formats)
            headers = {"Range": "bytes=0-262143"}
            response = await client.get(r2_url, headers=headers, follow_redirects=True)

            # 206 = partial content (range worked), 200 = full file (range ignored)
            if response.status_code not in (200, 206):
                response.raise_for_status()

            duration = extract_duration_from_bytes(response.content)
            if duration:
                logger.info(f"  → {duration}s")
                return (track_id, duration, None)

            # if range didn't give us duration, try full file
            if response.status_code == 206:
                logger.info("  range request didn't work, fetching full file...")
                response = await client.get(r2_url, follow_redirects=True)
                response.raise_for_status()
                duration = extract_duration_from_bytes(response.content)
                if duration:
                    logger.info(f"  → {duration}s")
                    return (track_id, duration, None)

            return (track_id, None, "could not extract duration")

        except httpx.HTTPStatusError as e:
            return (track_id, None, f"HTTP {e.response.status_code}")
        except Exception as e:
            return (track_id, None, str(e))


async def backfill_duration(dry_run: bool = False, concurrency: int = 10) -> None:
    """backfill duration for tracks missing it."""

    # phase 1: query tracks needing backfill, then close connection
    track_data: list[tuple[int, str, str | None, dict | None]] = []
    async with db_session() as db:
        stmt = select(Track).where(
            Track.extra["duration"].astext.is_(None) | ~Track.extra.has_key("duration")
        )
        result = await db.execute(stmt)
        tracks = list(result.scalars().all())

        if not tracks:
            logger.info("no tracks need duration backfill")
            return

        logger.info(f"found {len(tracks)} tracks needing duration backfill")

        if dry_run:
            logger.info("dry run mode - tracks that would be updated:")
            for track in tracks:
                logger.info(f"  {track.id}: {track.title} ({track.r2_url})")
            return

        # extract plain data before closing session
        track_data = [(t.id, t.title, t.r2_url, t.extra) for t in tracks]

    # phase 2: download files and extract durations (no DB connection)
    semaphore = asyncio.Semaphore(concurrency)
    logger.info(
        f"processing {len(track_data)} tracks with concurrency={concurrency}..."
    )

    async with httpx.AsyncClient(timeout=120.0) as client:
        results = await asyncio.gather(
            *[
                fetch_and_extract_simple(client, tid, title, r2_url, semaphore)
                for tid, title, r2_url, _ in track_data
            ]
        )

    # build update map
    updates: list[tuple[int, dict]] = []
    failed = 0
    track_extras = {tid: extra or {} for tid, _, _, extra in track_data}
    track_titles = {tid: title for tid, title, _, _ in track_data}

    for track_id, duration, error in results:
        if duration:
            new_extra = {**track_extras[track_id], "duration": duration}
            updates.append((track_id, new_extra))
        else:
            failed += 1
            logger.warning(
                f"failed track {track_id} ({track_titles[track_id]}): {error}"
            )

    if not updates:
        logger.info("no updates to commit")
        return

    # phase 3: fresh connection to commit updates
    logger.info(f"committing {len(updates)} updates...")
    async with db_session() as db:
        for track_id, new_extra in updates:
            stmt = update(Track).where(Track.id == track_id).values(extra=new_extra)
            await db.execute(stmt)
        await db.commit()

    logger.info(f"backfill complete: {len(updates)} updated, {failed} failed")


async def main() -> None:
    """main entry point."""
    dry_run = "--dry-run" in sys.argv

    concurrency = 10
    for i, arg in enumerate(sys.argv):
        if arg == "--concurrency" and i + 1 < len(sys.argv):
            concurrency = int(sys.argv[i + 1])

    if dry_run:
        logger.info("DRY RUN mode - no changes will be made")

    await backfill_duration(dry_run=dry_run, concurrency=concurrency)


if __name__ == "__main__":
    asyncio.run(main())
