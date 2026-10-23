#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "httpx",
#     "psycopg[binary]",
#     "pydantic-settings",
# ]
# ///
"""backfill track_plays from the teal.fm scrobbles plyr wrote for its listeners.

three steps, so the bandwidth-heavy one needs no database credentials:

    uv run scripts/backfill_teal_plays.py dids --env prod > dids.txt
    uv run scripts/backfill_teal_plays.py scan dids.txt plays.jsonl
    uv run scripts/backfill_teal_plays.py load plays.jsonl --env prod --dry-run
    uv run scripts/backfill_teal_plays.py load plays.jsonl --env prod

`scan` reads only public PDS records. It keeps plyr-origin plays from both
`fm.teal.alpha.feed.play` and `fm.teal.feed.play` and drops localhost origins.
`load` keeps plays of tracks that still exist and only those before the first
recorded (non-teal) play, then inserts `source = 'teal'` rows, skipping
duplicates. see docs/plans/2026-10-23-activity-smoothing-and-plays.md.

environment variables (set in .env or export):
    PROD_DATABASE_URL / STAGING_DATABASE_URL / DEV_DATABASE_URL
"""

import argparse
import asyncio
import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Literal

import httpx
import psycopg
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

COLLECTIONS = ("fm.teal.alpha.feed.play", "fm.teal.feed.play")
TRACK_URL = re.compile(r"^https://plyr\.fm/track/(\d+)")
Environment = Literal["dev", "staging", "prod"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    dev_database_url: str = Field(default="", validation_alias="DEV_DATABASE_URL")
    staging_database_url: str = Field(
        default="", validation_alias="STAGING_DATABASE_URL"
    )
    prod_database_url: str = Field(default="", validation_alias="PROD_DATABASE_URL")

    def url(self, env: Environment) -> str:
        url = getattr(self, f"{env}_database_url")
        if not url:
            sys.exit(f"no database URL configured for {env}")
        return re.sub(r"^postgresql\+\w+://", "postgresql://", url)


def plyr_track_id(value: dict) -> int | None:
    """the plyr track id a scrobble points at, or None if it is not plyr's."""
    origin = value.get("originUri") or value.get("originUrl") or ""
    from_plyr = (
        value.get("musicServiceBaseDomain") == "plyr.fm"
        or value.get("musicServiceUri") == "https://plyr.fm"
        or (value.get("submissionClientAgent") or "").startswith("plyr.fm/")
    )
    if not from_plyr or not (match := TRACK_URL.match(origin)):
        return None
    return int(match.group(1))


async def pds_for(client: httpx.AsyncClient, did: str) -> str | None:
    if did.startswith("did:plc:"):
        url = f"https://plc.directory/{did}"
    else:
        url = f"https://{did.removeprefix('did:web:')}/.well-known/did.json"
    doc = (await client.get(url)).json()
    return next(
        (
            s["serviceEndpoint"]
            for s in doc.get("service", [])
            if s["id"].endswith("#atproto_pds")
        ),
        None,
    )


async def scan_repo(
    client: httpx.AsyncClient, sem: asyncio.Semaphore, did: str, out: list[dict]
) -> str | None:
    async with sem:
        try:
            pds = await pds_for(client, did)
        except httpx.HTTPError as e:
            return f"{did}: resolve failed ({e})"
        if not pds:
            return f"{did}: no pds"
        for collection in COLLECTIONS:
            cursor: str | None = None
            while True:
                params = {"repo": did, "collection": collection, "limit": 100}
                if cursor:
                    params["cursor"] = cursor
                try:
                    response = await client.get(
                        f"{pds}/xrpc/com.atproto.repo.listRecords", params=params
                    )
                    response.raise_for_status()
                except httpx.HTTPError as e:
                    return f"{did} {collection}: {e}"
                body = response.json()
                for record in body.get("records", []):
                    value = record["value"]
                    if (track_id := plyr_track_id(value)) and value.get("playedTime"):
                        out.append(
                            {"track_id": track_id, "played_at": value["playedTime"]}
                        )
                if not body.get("records") or not (cursor := body.get("cursor")):
                    break
    return None


async def scan(dids_file: Path, out_file: Path) -> None:
    dids = dids_file.read_text().split()
    plays: list[dict] = []
    sem = asyncio.Semaphore(8)
    async with httpx.AsyncClient(timeout=30) as client:
        errors = await asyncio.gather(
            *(scan_repo(client, sem, did, plays) for did in dids)
        )
    out_file.write_text("".join(json.dumps(p) + "\n" for p in plays))
    for error in filter(None, errors):
        print(f"incomplete: {error}", file=sys.stderr)
    print(f"{len(plays)} plyr-origin plays from {len(dids)} repos -> {out_file}")


def export_dids(env: Environment) -> None:
    with psycopg.connect(Settings().url(env)) as conn:
        for (did,) in conn.execute("SELECT did FROM artists ORDER BY did"):
            print(did)


def load(plays_file: Path, env: Environment, dry_run: bool) -> None:
    plays = [json.loads(line) for line in plays_file.read_text().splitlines() if line]
    with psycopg.connect(Settings().url(env)) as conn:
        existing = {
            row[0]
            for row in conn.execute(
                "SELECT id FROM tracks WHERE id = ANY(%s)",
                (list({p["track_id"] for p in plays}),),
            )
        }
        cutoff = conn.execute(
            "SELECT MIN(played_at) FROM track_plays WHERE source != 'teal'"
        ).fetchone()[0]
        rows = []
        for play in plays:
            played_at = datetime.fromisoformat(play["played_at"])
            if play["track_id"] in existing and (cutoff is None or played_at < cutoff):
                rows.append((play["track_id"], played_at))
        by_month = Counter(played_at.strftime("%Y-%m") for _, played_at in rows)
        print(
            f"{len(plays)} scanned, {len(rows)} loadable "
            f"({len(plays) - len(rows)} dropped: deleted track or after {cutoff})"
        )
        for month, count in sorted(by_month.items()):
            print(f"  {month} {count}")
        if dry_run:
            return
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO track_plays (track_id, played_at, source) "
                "VALUES (%s, %s, 'teal') ON CONFLICT DO NOTHING",
                rows,
            )
        conn.commit()
        total = conn.execute(
            "SELECT count(*) FROM track_plays WHERE source = 'teal'"
        ).fetchone()[0]
        print(f"teal rows now in track_plays: {total}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    dids = commands.add_parser("dids")
    dids.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    scan_cmd = commands.add_parser("scan")
    scan_cmd.add_argument("dids_file", type=Path)
    scan_cmd.add_argument("out_file", type=Path)
    load_cmd = commands.add_parser("load")
    load_cmd.add_argument("plays_file", type=Path)
    load_cmd.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    load_cmd.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.command == "dids":
        export_dids(args.env)
    elif args.command == "scan":
        asyncio.run(scan(args.dids_file, args.out_file))
    else:
        load(args.plays_file, args.env, args.dry_run)


if __name__ == "__main__":
    main()
