#!/usr/bin/env -S uv run --script --quiet
"""rewrite track/album/playlist images to bake EXIF Orientation into pixels.

usage:
    uv run scripts/backfill_image_orientation.py --dry-run
    uv run scripts/backfill_image_orientation.py --limit 5
    uv run scripts/backfill_image_orientation.py --concurrency 10
"""

import argparse
import asyncio
import logging
import time
from pathlib import PurePosixPath

import httpx
from sqlalchemy import select

from backend._internal.image import has_exif_rotation, normalize_orientation
from backend._internal.thumbnails import generate_thumbnail
from backend.models import Album, Track
from backend.models.playlist import Playlist
from backend.storage import _get_storage
from backend.utilities.database import db_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


async def _overwrite_object(image_id: str, image_url: str, data: bytes) -> None:
    """upload `data` to R2 at the existing image's key, preserving image_id."""
    r2 = _get_storage()  # unwrap the lazy module-level proxy
    ext = PurePosixPath(image_url.split("?")[0]).suffix.lower() or ".jpg"
    key = f"images/{image_id}{ext}"
    media_type = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(ext, "application/octet-stream")
    async with r2._s3_client() as client:
        await client.put_object(
            Bucket=r2.image_bucket_name,
            Key=key,
            Body=data,
            ContentType=media_type,
        )


async def _process_one(
    row: dict,
    http: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    counter: dict[str, int],
    total: int,
    dry_run: bool,
) -> None:
    async with sem:
        idx = counter["started"] + 1
        counter["started"] += 1
        label = f"{row['table']} {row['id']} (image_id={row['image_id']})"

        try:
            resp = await http.get(row["image_url"])
            resp.raise_for_status()
            original = resp.content

            if not has_exif_rotation(original):
                counter["upright"] += 1
                logger.info("[%d/%d] %s: already upright", idx, total, label)
                return

            normalized = normalize_orientation(original)
            if normalized == original:
                counter["upright"] += 1
                logger.info(
                    "[%d/%d] %s: orientation tag present but normalize was a no-op",
                    idx,
                    total,
                    label,
                )
                return

            if dry_run:
                counter["would_fix"] += 1
                logger.info(
                    "[%d/%d] %s: would rewrite (%d → %d bytes) + regen thumbnail",
                    idx,
                    total,
                    label,
                    len(original),
                    len(normalized),
                )
                return

            await _overwrite_object(row["image_id"], row["image_url"], normalized)
            thumb_data = generate_thumbnail(normalized)
            await _get_storage().save_thumbnail(thumb_data, row["image_id"])
            counter["fixed"] += 1
            logger.info(
                "[%d/%d] %s: rewrote (%d → %d bytes) + regenerated thumbnail",
                idx,
                total,
                label,
                len(original),
                len(normalized),
            )
        except Exception:
            logger.exception("failed for %s", label)
            counter["failed"] += 1


async def _gather_rows(limit: int | None) -> list[dict]:
    rows: list[dict] = []
    async with db_session() as db:
        for table_name, model in (
            ("track", Track),
            ("album", Album),
            ("playlist", Playlist),
        ):
            remaining = (limit - len(rows)) if limit else None
            if limit and remaining is not None and remaining <= 0:
                break
            stmt = (
                select(model)
                .where(model.image_id.isnot(None), model.image_url.isnot(None))
                .order_by(model.id)
            )
            if remaining:
                stmt = stmt.limit(remaining)
            result = await db.execute(stmt)
            for entity in result.scalars():
                rows.append(
                    {
                        "table": table_name,
                        "id": entity.id,
                        "image_id": entity.image_id,
                        "image_url": entity.image_url,
                    }
                )
    return rows


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would change without writing to R2",
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="cap on number of rows to process"
    )
    parser.add_argument(
        "--concurrency", type=int, default=8, help="parallel workers (default 8)"
    )
    args = parser.parse_args()

    rows = await _gather_rows(args.limit)
    if not rows:
        logger.info("no rows with images found")
        return

    logger.info(
        "checking %d images (concurrency=%d, dry_run=%s)",
        len(rows),
        args.concurrency,
        args.dry_run,
    )

    sem = asyncio.Semaphore(args.concurrency)
    counter = {"started": 0, "upright": 0, "would_fix": 0, "fixed": 0, "failed": 0}
    t0 = time.monotonic()

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as http:
        await asyncio.gather(
            *[
                _process_one(row, http, sem, counter, len(rows), args.dry_run)
                for row in rows
            ]
        )

    elapsed = time.monotonic() - t0
    logger.info(
        "done in %.0fs: upright=%d, would_fix=%d, fixed=%d, failed=%d (total=%d)",
        elapsed,
        counter["upright"],
        counter["would_fix"],
        counter["fixed"],
        counter["failed"],
        len(rows),
    )


if __name__ == "__main__":
    asyncio.run(main())
