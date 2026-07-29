#!/usr/bin/env -S uv run --script --quiet
"""reconcile Artist.deactivated against each account's *current* PDS.

going forward, #account firehose events keep Artist.deactivated current (see
ingest_account_status_change). this script exists to repair drift.

the PDS is always resolved fresh from plc.directory, never from the cached
`Artist.pds_url`. that cache is exactly what goes stale when someone migrates,
and the host they left reports their repo as `deactivated` — truthfully about
itself, and misleadingly about them. asking the stale host is how this script
once proposed hiding twelve live artists who had simply moved to their own PDS.

usage:
    uv run scripts/backfill_account_status.py --dry-run
    uv run scripts/backfill_account_status.py --concurrency 8
    uv run scripts/backfill_account_status.py --did did:plc:6r5lmfugglmlsgvundyzt6z4
"""

import argparse
import asyncio
import logging

import httpx
from sqlalchemy import select

from backend._internal.atproto.account_status import hides_content
from backend.models import Artist
from backend.utilities.database import db_session

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("backfill_account_status")


async def _resolve_pds(client: httpx.AsyncClient, did: str) -> str | None:
    try:
        r = await client.get(f"https://plc.directory/{did}")
        r.raise_for_status()
        for svc in r.json().get("service", []):
            if svc.get("id") == "#atproto_pds":
                return svc["serviceEndpoint"]
    except Exception as e:
        logger.warning("  resolve pds failed %s: %s", did, e)
    return None


async def _repo_status(
    client: httpx.AsyncClient, did: str
) -> tuple[bool, str | None] | None:
    """(hidden, status) if known, None if we couldn't determine.

    uses the same `hides_content` rule as the firehose path, so a one-shot
    reconciliation can never disagree with the live events about what an
    inactive repo means.
    """
    pds = await _resolve_pds(client, did)
    if not pds:
        return None
    try:
        r = await client.get(
            f"{pds}/xrpc/com.atproto.sync.getRepoStatus", params={"did": did}
        )
        if r.status_code != 200:
            return None
        body = r.json()
        active, status = body.get("active", True), body.get("status")
        return hides_content(active, status), None if active else status
    except Exception as e:
        logger.warning("  getRepoStatus failed %s: %s", did, e)
        return None


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--did", help="check a single DID")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    async with db_session() as db:
        stmt = select(Artist.did, Artist.deactivated, Artist.account_status)
        if args.did:
            stmt = stmt.where(Artist.did == args.did)
        if args.limit:
            stmt = stmt.limit(args.limit)
        rows = (await db.execute(stmt)).all()

    logger.info("checking %d artists (concurrency=%d)", len(rows), args.concurrency)
    sem = asyncio.Semaphore(args.concurrency)
    changed: list[tuple[str, bool, str | None]] = []

    async with httpx.AsyncClient(timeout=20) as client:

        async def check(did: str, current: bool, current_status: str | None) -> None:
            async with sem:
                result = await _repo_status(client, did)
            if result is None:
                return
            deactivated, status = result
            if deactivated != current or status != current_status:
                changed.append((did, deactivated, status))
                logger.info(
                    "  %s: deactivated %s -> %s (%s)", did, current, deactivated, status
                )

        await asyncio.gather(*(check(d, bool(c), st) for d, c, st in rows))

    logger.info("%d artists need updating", len(changed))
    if args.dry_run or not changed:
        return

    async with db_session() as db:
        for did, deactivated, status in changed:
            artist = await db.get(Artist, did)
            if artist:
                artist.deactivated = deactivated
                artist.account_status = status
        await db.commit()
    logger.info("updated %d artists", len(changed))


if __name__ == "__main__":
    asyncio.run(main())
