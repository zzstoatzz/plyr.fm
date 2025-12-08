#!/usr/bin/env -S uv run --script --quiet
"""view per-user upload duration statistics.

## Context

Track how much content each user has uploaded to support future upload caps.
Currently informational - no enforcement yet.

## What This Script Does

1. Queries all tracks grouped by artist
2. Sums duration from extra JSONB column
3. Displays sorted by total upload time

## Usage

```bash
# show all users with upload stats
uv run scripts/user_upload_stats.py

# show only users above a threshold (in hours)
uv run scripts/user_upload_stats.py --min-hours 1

# target specific environment
DATABASE_URL=postgresql://... uv run scripts/user_upload_stats.py
```
"""

import asyncio
import logging
import sys
from pathlib import Path

# add src to path so we can import backend modules
sys.path.insert(0, str(Path(__file__).parent.parent / "backend" / "src"))

from sqlalchemy import func, select, text

from backend.models import Artist, Track
from backend.utilities.database import db_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def format_duration(total_seconds: int) -> str:
    """format seconds into human-readable duration string."""
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60

    if hours == 0:
        return f"{minutes}m"
    if minutes == 0:
        return f"{hours}h"
    return f"{hours}h {minutes}m"


async def get_user_upload_stats(min_hours: float = 0) -> None:
    """query and display per-user upload statistics."""

    min_seconds = int(min_hours * 3600)

    async with db_session() as db:
        # aggregate tracks by artist
        stmt = (
            select(
                Track.artist_did,
                Artist.handle,
                Artist.display_name,
                func.count(Track.id).label("track_count"),
                func.coalesce(
                    func.sum(text("(tracks.extra->>'duration')::int")),
                    0,
                ).label("total_seconds"),
            )
            .join(Artist, Track.artist_did == Artist.did)
            .group_by(Track.artist_did, Artist.handle, Artist.display_name)
            .order_by(text("total_seconds DESC"))
        )

        result = await db.execute(stmt)
        rows = result.all()

        if not rows:
            logger.info("no tracks found")
            return

        # also get totals
        total_stmt = select(
            func.count(Track.id),
            func.coalesce(func.sum(text("(tracks.extra->>'duration')::int")), 0),
        )
        total_result = await db.execute(total_stmt)
        total_row = total_result.one()
        total_tracks = total_row[0]
        total_seconds = total_row[1]

        print("\n" + "=" * 80)
        print("USER UPLOAD STATISTICS")
        print("=" * 80)
        print(
            f"\nPlatform totals: {total_tracks} tracks, {format_duration(total_seconds)}"
        )
        print("-" * 80)
        print(f"{'handle':<30} {'display name':<20} {'tracks':>8} {'duration':>12}")
        print("-" * 80)

        shown = 0
        for row in rows:
            artist_did, handle, display_name, track_count, user_seconds = row

            if user_seconds < min_seconds:
                continue

            shown += 1
            display = (display_name or handle)[:20]
            handle_str = handle[:30] if handle else artist_did[:30]

            print(
                f"{handle_str:<30} {display:<20} {track_count:>8} {format_duration(user_seconds):>12}"
            )

        print("-" * 80)

        if min_hours > 0:
            hidden = len(rows) - shown
            print(
                f"showing {shown} users with >= {min_hours}h (hiding {hidden} below threshold)"
            )
        else:
            print(f"total: {len(rows)} users")

        print()


async def main() -> None:
    """main entry point."""
    min_hours = 0.0

    for i, arg in enumerate(sys.argv):
        if arg == "--min-hours" and i + 1 < len(sys.argv):
            min_hours = float(sys.argv[i + 1])

    await get_user_upload_stats(min_hours=min_hours)


if __name__ == "__main__":
    asyncio.run(main())
