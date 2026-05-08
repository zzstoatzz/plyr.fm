#!/usr/bin/env -S uv run --script --quiet
"""resync Artist.handle / display_name / avatar_url from Bluesky.

catches artists whose identity drifted before #1200 (Jetstream identity-event
sync, shipped 2026-03-30) or whose displayName was never re-pulled from bsky
(ingest_identity_update only syncs handle/pds_url/avatar_url, not
display_name).

display_name is only updated when it currently equals the stored handle —
that's the "auto-defaulted from handle" marker set by ensure_artist_exists().
if the user has explicitly set a different display name, we leave it alone.

UserSession.handle is updated in lockstep with Artist.handle so any active
sessions for the artist see the fresh value (mirrors ingest_identity_update).

usage:
    uv run scripts/backfill_artist_identity.py --dry-run
    uv run scripts/backfill_artist_identity.py --limit 25
    uv run scripts/backfill_artist_identity.py --concurrency 4
    uv run scripts/backfill_artist_identity.py --did did:plc:njqwgoba3zvwuexfmdbkl62v
"""

import argparse
import asyncio
import logging
import time
from datetime import UTC, datetime

from sqlalchemy import select, update

from backend._internal.atproto.profile import (
    fetch_user_profile,
    normalize_avatar_url,
)
from backend.models import Artist, UserSession
from backend.utilities.database import db_session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def _compute_changes(
    artist: Artist, profile: dict
) -> dict[str, tuple[str | None, str | None]]:
    """diff stored Artist row against fresh bsky profile.

    returns a dict of {field: (old, new)} for fields that need to change.
    only updates display_name when it equals the stored handle (the
    ensure_artist_exists default marker) — preserves explicit user choices.
    """
    changes: dict[str, tuple[str | None, str | None]] = {}

    target_handle: str | None = profile.get("handle")
    target_display_name: str | None = profile.get("displayName") or target_handle
    target_avatar = normalize_avatar_url(profile.get("avatar"))

    if target_handle and artist.handle != target_handle:
        changes["handle"] = (artist.handle, target_handle)

    # only sync display_name when it's still the auto-default (== stored handle).
    # if the user customized it, leave their choice alone.
    if (
        target_display_name
        and artist.display_name == artist.handle
        and artist.display_name != target_display_name
    ):
        changes["display_name"] = (artist.display_name, target_display_name)

    if target_avatar and artist.avatar_url != target_avatar:
        changes["avatar_url"] = (artist.avatar_url, target_avatar)

    return changes


async def _process_one(
    did: str,
    sem: asyncio.Semaphore,
    counter: dict[str, int],
    total: int,
    dry_run: bool,
) -> None:
    async with sem:
        idx = counter["started"] + 1
        counter["started"] += 1

        try:
            profile = await fetch_user_profile(did)
            if not profile:
                counter["unresolved"] += 1
                logger.info(
                    "[%d/%d] %s: no bsky profile (deactivated?)", idx, total, did
                )
                return

            async with db_session() as db:
                artist = await db.get(Artist, did)
                if not artist:
                    counter["missing"] += 1
                    logger.warning("[%d/%d] %s: artist row vanished", idx, total, did)
                    return

                changes = _compute_changes(artist, profile)

                if not changes:
                    counter["fresh"] += 1
                    logger.info(
                        "[%d/%d] @%s: already current", idx, total, artist.handle
                    )
                    return

                summary = ", ".join(
                    f"{k}: {v[0]!r} -> {v[1]!r}" for k, v in changes.items()
                )

                if dry_run:
                    counter["would_fix"] += 1
                    logger.info(
                        "[%d/%d] %s: would update {%s}", idx, total, did, summary
                    )
                    return

                # apply changes to the Artist row
                for field, (_old, new) in changes.items():
                    setattr(artist, field, new)
                artist.updated_at = datetime.now(UTC)

                # mirror handle change onto active sessions, like
                # ingest_identity_update does for live identity events
                if "handle" in changes:
                    await db.execute(
                        update(UserSession)
                        .where(UserSession.did == did)
                        .values(handle=changes["handle"][1])
                    )

                await db.commit()
                counter["fixed"] += 1
                logger.info("[%d/%d] %s: updated {%s}", idx, total, did, summary)

        except Exception:
            logger.exception("failed for %s", did)
            counter["failed"] += 1


async def _gather_dids(limit: int | None, did_filter: str | None) -> list[str]:
    async with db_session() as db:
        stmt = select(Artist.did).order_by(Artist.created_at)
        if did_filter:
            stmt = stmt.where(Artist.did == did_filter)
        if limit:
            stmt = stmt.limit(limit)
        result = await db.execute(stmt)
        return [row[0] for row in result.fetchall()]


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would change without writing to the database",
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="cap on number of artists to process"
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="parallel workers (default 4 — bsky public API is rate-limited)",
    )
    parser.add_argument(
        "--did",
        type=str,
        default=None,
        help="restrict to a single DID (useful for spot fixes)",
    )
    args = parser.parse_args()

    dids = await _gather_dids(args.limit, args.did)
    if not dids:
        logger.info("no artists matched")
        return

    logger.info(
        "checking %d artists (concurrency=%d, dry_run=%s)",
        len(dids),
        args.concurrency,
        args.dry_run,
    )

    sem = asyncio.Semaphore(args.concurrency)
    counter = {
        "started": 0,
        "fresh": 0,
        "would_fix": 0,
        "fixed": 0,
        "unresolved": 0,
        "missing": 0,
        "failed": 0,
    }
    t0 = time.monotonic()

    await asyncio.gather(
        *[_process_one(did, sem, counter, len(dids), args.dry_run) for did in dids]
    )

    elapsed = time.monotonic() - t0
    logger.info(
        "done in %.0fs: fresh=%d, would_fix=%d, fixed=%d, unresolved=%d, "
        "missing=%d, failed=%d (total=%d)",
        elapsed,
        counter["fresh"],
        counter["would_fix"],
        counter["fixed"],
        counter["unresolved"],
        counter["missing"],
        counter["failed"],
        len(dids),
    )


if __name__ == "__main__":
    asyncio.run(main())
