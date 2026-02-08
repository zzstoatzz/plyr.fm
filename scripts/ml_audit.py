#!/usr/bin/env -S uv run --script --quiet
"""audit which tracks have been processed by ML features.

## Context

Several features run track audio through external ML services:
- **genre classification**: effnet-discogs on Replicate — stored in track.extra["genre_predictions"]
- **CLAP embeddings**: laion/clap-htsat-unfused on Modal — stored in turbopuffer
- **auto-tagging**: applies genre predictions as tags — leaves no extra flag (cleaned up after)

this script reports which tracks and artists have been processed, for privacy
policy and terms-of-service auditing.

## Usage

```bash
# from repo root (requires DATABASE_URL or backend config)
cd backend && uv run python ../scripts/ml_audit.py

# show track-level detail instead of just counts
cd backend && uv run python ../scripts/ml_audit.py --verbose

# check turbopuffer embedding counts too (requires TURBOPUFFER_API_KEY)
cd backend && uv run python ../scripts/ml_audit.py --check-embeddings
```
"""

import argparse
import asyncio
import logging
import os

from sqlalchemy import func, select, text

from backend.config import settings

# suppress SQLAlchemy echo noise from debug mode
settings.app.debug = False

from backend.models import Artist, Track  # noqa: E402
from backend.utilities.database import db_session  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
)
logger = logging.getLogger(__name__)


async def audit_genre_classifications(verbose: bool) -> None:
    """report tracks with genre predictions in extra."""
    async with db_session() as db:
        # summary by artist
        summary = await db.execute(
            select(
                Artist.handle,
                func.count(Track.id).label("track_count"),
            )
            .join(Artist, Track.artist_did == Artist.did)
            .where(text("tracks.extra->'genre_predictions' IS NOT NULL"))
            .group_by(Artist.handle)
            .order_by(func.count(Track.id).desc())
        )
        rows = summary.all()

        total = sum(r.track_count for r in rows)
        logger.info(
            "genre classification: %d tracks across %d artists", total, len(rows)
        )
        for row in rows:
            logger.info("  %s: %d tracks", row.handle, row.track_count)

        if verbose and total > 0:
            detail = await db.execute(
                select(
                    Track.id,
                    Track.title,
                    Artist.handle,
                    Track.created_at,
                )
                .join(Artist, Track.artist_did == Artist.did)
                .where(text("tracks.extra->'genre_predictions' IS NOT NULL"))
                .order_by(Track.created_at.desc())
            )
            logger.info("")
            logger.info("  %-6s %-40s %-25s %s", "id", "title", "handle", "created")
            logger.info("  %s", "-" * 100)
            for row in detail.all():
                title = row.title[:38] + ".." if len(row.title) > 40 else row.title
                logger.info(
                    "  %-6d %-40s %-25s %s",
                    row.id,
                    title,
                    row.handle,
                    row.created_at.strftime("%Y-%m-%d %H:%M"),
                )


async def audit_auto_tagged(verbose: bool) -> None:
    """report tracks with auto_tag flag still pending (not yet processed)."""
    async with db_session() as db:
        result = await db.execute(
            select(func.count(Track.id)).where(
                text("(tracks.extra->>'auto_tag')::boolean = true")
            )
        )
        pending = result.scalar() or 0
        if pending > 0:
            logger.info(
                "\nauto-tag: %d tracks pending (flag not yet cleaned up)", pending
            )
        else:
            logger.info(
                "\nauto-tag: no pending flags (all processed or none requested)"
            )


async def audit_embeddings(verbose: bool) -> None:
    """check turbopuffer for embedding counts."""
    try:
        import turbopuffer as tpuf
    except ImportError:
        logger.warning("turbopuffer not installed, skipping embedding audit")
        return

    api_key = os.environ.get("TURBOPUFFER_API_KEY")
    if not api_key:
        logger.warning("TURBOPUFFER_API_KEY not set, skipping embedding audit")
        return

    tpuf.api_key = api_key
    namespace = os.environ.get("TURBOPUFFER_NAMESPACE", "plyr-tracks")
    ns = tpuf.Namespace(namespace)

    try:
        # query with a zero vector to get total count
        # turbopuffer requires rank_by for queries
        zero_vec = [0.0] * 512
        results = ns.query(
            rank_by=["vector", "ANN", zero_vec],
            top_k=10000,
            include_attributes=["title", "artist_handle"],
        )

        if not results:
            logger.info("\nembeddings (%s): 0 vectors", namespace)
            return

        # count by artist
        artist_counts: dict[str, int] = {}
        for row in results:
            handle = getattr(row, "attributes", {}).get("artist_handle", "unknown")
            artist_counts[handle] = artist_counts.get(handle, 0) + 1

        total = len(results)
        logger.info(
            "\nembeddings (%s): %d vectors across %d artists",
            namespace,
            total,
            len(artist_counts),
        )
        for handle, count in sorted(artist_counts.items(), key=lambda x: -x[1]):
            logger.info("  %s: %d tracks", handle, count)

    except Exception as e:
        logger.error("failed to query turbopuffer: %s", e)


async def main() -> None:
    parser = argparse.ArgumentParser(description="audit ML-processed tracks")
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="show track-level detail"
    )
    parser.add_argument(
        "--check-embeddings",
        action="store_true",
        help="also check turbopuffer for embedding counts",
    )
    args = parser.parse_args()

    # total track count for context
    async with db_session() as db:
        result = await db.execute(select(func.count(Track.id)))
        total = result.scalar() or 0
    logger.info("total tracks in database: %d\n", total)

    await audit_genre_classifications(args.verbose)
    await audit_auto_tagged(args.verbose)

    if args.check_embeddings:
        await audit_embeddings(args.verbose)

    logger.info("")


if __name__ == "__main__":
    asyncio.run(main())
