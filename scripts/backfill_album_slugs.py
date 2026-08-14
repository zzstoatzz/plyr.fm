#!/usr/bin/env -S uv run --script --quiet
"""backfill album slugs mangled by the pre-transliteration slugify.

## Context

slugify() used to delete non-ASCII letters outright instead of
transliterating them, so "tūnņg" became "tng" and "Orações diárias"
became "oraes-dirias". slugify now NFKD-normalizes first, but existing
albums keep their mangled slugs.

## What This Script Does

1. finds albums whose stored slug matches what the OLD slugify derived
   from the title (i.e. app-derived — artist-chosen custom slugs are
   left alone)
2. recomputes the slug with the fixed slugify
3. updates rows where the two differ, skipping any that would collide
   with another album's slug for the same artist

old URLs break by design: the album cache TTL is 5 minutes, so no
invalidation is needed.

## Usage

```bash
# dry run (show what would change)
uv run scripts/backfill_album_slugs.py --dry-run

# apply
uv run scripts/backfill_album_slugs.py
```
"""

import argparse
import asyncio
import logging
import re

from sqlalchemy import select

from backend.models import Album, Artist
from backend.utilities.database import db_session
from backend.utilities.slugs import slugify

logging.basicConfig(level=logging.INFO, format="%(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def old_slugify(text: str, max_length: int = 100) -> str:
    """the pre-fix pipeline: no transliteration, non-ASCII deleted."""
    if not text:
        return ""
    slug = text.lower()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    slug = slug.strip("-")
    if len(slug) > max_length:
        slug = slug[:max_length]
        last_hyphen = slug.rfind("-")
        if last_hyphen > 0:
            slug = slug[:last_hyphen]
    return slug


async def backfill(dry_run: bool = False) -> None:
    async with db_session() as db:
        result = await db.execute(
            select(Album, Artist.handle).join(Artist, Album.artist_did == Artist.did)
        )
        rows = result.all()

        changed = 0
        for album, handle in rows:
            if album.slug != old_slugify(album.title):
                continue  # custom slug, or already correct under both pipelines
            new_slug = slugify(album.title)
            if not new_slug or new_slug == album.slug:
                continue
            conflict = await db.execute(
                select(Album.id).where(
                    Album.artist_did == album.artist_did,
                    Album.slug == new_slug,
                    Album.id != album.id,
                )
            )
            if conflict.scalar_one_or_none() is not None:
                logger.warning(
                    "skipping %r by %s: slug %r already taken",
                    album.title,
                    handle,
                    new_slug,
                )
                continue
            logger.info(
                "%s %r by %s: %s -> %s",
                "would update" if dry_run else "updating",
                album.title,
                handle,
                album.slug,
                new_slug,
            )
            if not dry_run:
                album.slug = new_slug
            changed += 1

        if not dry_run:
            await db.commit()

    logger.info("%d slug(s) %s", changed, "would change" if dry_run else "updated")


async def main() -> None:
    parser = argparse.ArgumentParser(description="backfill mangled album slugs")
    parser.add_argument(
        "--dry-run", action="store_true", help="show what would be done"
    )
    args = parser.parse_args()
    await backfill(dry_run=args.dry_run)


if __name__ == "__main__":
    asyncio.run(main())
