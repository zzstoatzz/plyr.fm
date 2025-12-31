#!/usr/bin/env -S uv run --script --quiet
"""backfill avatar_url for all artists from bluesky.

## Context

Avatar URLs were only set at artist creation and never refreshed. This caused
stale/broken avatars throughout the app (likers tooltip, profiles, etc).

PR #685 added avatar sync on login, but users who don't log in will still have
stale avatars. This script does a one-time refresh of all avatars.

## What This Script Does

1. Fetches all artists from the database
2. For each artist, fetches current avatar from Bluesky public API
3. Updates avatar_url in database if changed
4. Reports summary of changes

## Usage

```bash
# dry run (show what would be updated)
uv run scripts/backfill_avatars.py --dry-run

# actually update the database
uv run scripts/backfill_avatars.py

# target specific environment
DATABASE_URL=postgresql://... uv run scripts/backfill_avatars.py
```
"""

import asyncio
import logging
import sys

# scripts are run from backend/ directory via: uv run python ../scripts/backfill_avatars.py

from sqlalchemy import select

from backend._internal.atproto.profile import fetch_user_avatar
from backend.models import Artist
from backend.utilities.database import db_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# rate limit to avoid hammering bluesky API
CONCURRENCY_LIMIT = 5
DELAY_BETWEEN_BATCHES = 0.5  # seconds


async def backfill_avatars(dry_run: bool = False) -> None:
    """backfill avatar_url for all artists from bluesky."""

    async with db_session() as db:
        result = await db.execute(select(Artist))
        artists = result.scalars().all()

        if not artists:
            logger.info("no artists found")
            return

        logger.info(f"found {len(artists)} artists to check")

        if dry_run:
            logger.info("dry run mode - checking avatars without updating:")

        updated = 0
        unchanged = 0
        failed = 0
        cleared = 0

        # process in batches to rate limit
        semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)

        async def process_artist(
            artist: Artist,
        ) -> tuple[str, str | None, str | None, Exception | None]:
            """fetch avatar for artist, return (did, old_url, new_url, error)."""
            async with semaphore:
                try:
                    fresh_avatar = await fetch_user_avatar(artist.did)
                    return (artist.did, artist.avatar_url, fresh_avatar, None)
                except Exception as e:
                    return (artist.did, artist.avatar_url, None, e)

        # fetch all avatars concurrently (with semaphore limiting)
        logger.info("fetching avatars from bluesky...")
        results = await asyncio.gather(*[process_artist(a) for a in artists])

        # process results
        for did, old_url, new_url, error in results:
            artist = next(a for a in artists if a.did == did)

            if error:
                failed += 1
                logger.warning(f"failed to fetch avatar for {artist.handle}: {error}")
                continue

            if old_url == new_url:
                unchanged += 1
                continue

            if new_url is None and old_url is not None:
                cleared += 1
                action = "would clear" if dry_run else "clearing"
                logger.info(
                    f"{action} avatar for {artist.handle} (was: {old_url[:50]}...)"
                )
            elif new_url is not None and old_url is None:
                updated += 1
                action = "would set" if dry_run else "setting"
                logger.info(f"{action} avatar for {artist.handle}")
            else:
                updated += 1
                action = "would update" if dry_run else "updating"
                logger.info(f"{action} avatar for {artist.handle}")

            if not dry_run:
                artist.avatar_url = new_url

        if not dry_run:
            await db.commit()

        logger.info(
            f"backfill complete: {updated} updated, {cleared} cleared, "
            f"{unchanged} unchanged, {failed} failed"
        )


async def main() -> None:
    """main entry point."""
    dry_run = "--dry-run" in sys.argv

    if dry_run:
        logger.info("running in DRY RUN mode - no changes will be made")

    await backfill_avatars(dry_run=dry_run)


if __name__ == "__main__":
    asyncio.run(main())
