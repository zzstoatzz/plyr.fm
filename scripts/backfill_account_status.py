#!/usr/bin/env -S uv run --script --quiet
"""backfill Artist.deactivated by checking each account's PDS status.

going forward, #account firehose events keep Artist.deactivated current (see
ingest_account_status_change). but accounts that deactivated *before* that flag
existed won't emit a new event, so their content (incl. dead audio) keeps showing
up in discovery. this script resolves each artist's PDS and asks
com.atproto.sync.getRepoStatus whether the account is active, then sets the flag.

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


async def _is_deactivated(
    client: httpx.AsyncClient, did: str, pds_url: str | None
) -> bool | None:
    """True/False if known, None if we couldn't determine (left unchanged)."""
    pds = pds_url or await _resolve_pds(client, did)
    if not pds:
        return None
    try:
        r = await client.get(
            f"{pds}/xrpc/com.atproto.sync.getRepoStatus", params={"did": did}
        )
        if r.status_code != 200:
            return None
        return not r.json().get("active", True)
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
        stmt = select(Artist.did, Artist.pds_url, Artist.deactivated)
        if args.did:
            stmt = stmt.where(Artist.did == args.did)
        if args.limit:
            stmt = stmt.limit(args.limit)
        rows = (await db.execute(stmt)).all()

    logger.info("checking %d artists (concurrency=%d)", len(rows), args.concurrency)
    sem = asyncio.Semaphore(args.concurrency)
    changed: list[tuple[str, bool]] = []

    async with httpx.AsyncClient(timeout=20) as client:

        async def check(did: str, pds_url: str | None, current: bool) -> None:
            async with sem:
                deactivated = await _is_deactivated(client, did, pds_url)
            if deactivated is not None and deactivated != current:
                changed.append((did, deactivated))
                logger.info("  %s: deactivated %s -> %s", did, current, deactivated)

        await asyncio.gather(*(check(d, p, bool(c)) for d, p, c in rows))

    logger.info("%d artists need updating", len(changed))
    if args.dry_run or not changed:
        return

    async with db_session() as db:
        for did, deactivated in changed:
            artist = await db.get(Artist, did)
            if artist:
                artist.deactivated = deactivated
        await db.commit()
    logger.info("updated %d artists", len(changed))


if __name__ == "__main__":
    asyncio.run(main())
