#!/usr/bin/env -S uv run --script --quiet --with-editable=backend
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "httpx",
#     "pydantic-settings",
# ]
# ///
"""Seed the moderation event log from existing copyright flags.

`copyright_scans.is_flagged` predates the event log, so flags raised before it
existed are invisible to the review queue. This opens one `flagged_by_scan`
event per already-flagged track.

It writes only to the moderation service's event log. It sends no
notifications and cannot: notifying uploaders about flags from months ago
because a queue was built today would be a bug, not a feature. The notification
path lives in the backend's scan handler and is not reachable from here.

usage:
    uv run scripts/backfill_moderation_queue.py --env prod --dry-run
    uv run scripts/backfill_moderation_queue.py --env prod
"""

import argparse
import asyncio
import os
import sys
from typing import Literal

import httpx
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from _moderation import DEFAULT_SERVICE_URL

Environment = Literal["dev", "staging", "prod"]
ACTOR = "service:backfill"


class BackfillSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", case_sensitive=False, extra="ignore"
    )

    dev_database_url: str = Field(default="", validation_alias="DEV_DATABASE_URL")
    staging_database_url: str = Field(
        default="", validation_alias="STAGING_DATABASE_URL"
    )
    prod_database_url: str = Field(default="", validation_alias="PROD_DATABASE_URL")
    moderation_service_url: str = Field(
        default=DEFAULT_SERVICE_URL, validation_alias="MODERATION_SERVICE_URL"
    )
    moderation_auth_token: str = Field(
        default="", validation_alias="MODERATION_AUTH_TOKEN"
    )

    def database_url(self, env: Environment) -> str:
        url = {
            "dev": self.dev_database_url,
            "staging": self.staging_database_url,
            "prod": self.prod_database_url,
        }.get(env, "")
        if not url:
            raise ValueError(f"no database URL configured for {env}")
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url.replace("sslmode=require", "ssl=require")


async def main(env: Environment, dry_run: bool) -> int:
    settings = BackfillSettings()
    if not settings.moderation_auth_token:
        print("MODERATION_AUTH_TOKEN is required")
        return 1

    os.environ["DATABASE_URL"] = settings.database_url(env)

    from sqlalchemy import select
    from sqlalchemy.orm import joinedload

    from backend.models import CopyrightScan, Track
    from backend.utilities.database import db_session

    async with db_session() as db:
        rows = (
            (
                await db.execute(
                    select(CopyrightScan, Track)
                    .join(Track, CopyrightScan.track_id == Track.id)
                    .options(joinedload(CopyrightScan.track))
                    .where(
                        CopyrightScan.is_flagged == True,  # noqa: E712
                        Track.atproto_record_uri.isnot(None),
                    )
                    .order_by(CopyrightScan.scanned_at)
                )
            )
            .unique()
            .all()
        )

    print(f"{len(rows)} flagged track(s) with an AT URI\n")

    async with httpx.AsyncClient(
        base_url=settings.moderation_service_url,
        headers={"X-Moderation-Key": settings.moderation_auth_token},
        timeout=30.0,
    ) as client:
        # skip subjects already in the log so re-running cannot pile up
        # duplicate queue entries
        existing: set[str] = set()
        queue = await client.get("/admin/queue")
        queue.raise_for_status()
        existing = {item["subject_uri"] for item in queue.json().get("items", [])}

        opened = 0
        for scan, track in rows:
            uri = track.atproto_record_uri
            marker = "skip (already open)" if uri in existing else "open"
            print(
                f"  [{marker}] track {track.id}: {track.title[:48]!r} "
                f"({len(scan.matches or [])} matches, {scan.scanned_at:%Y-%m-%d})"
            )
            if uri in existing or dry_run:
                continue
            r = await client.post(
                "/internal/events",
                json={
                    "subject_uri": uri,
                    "subject_track_id": track.id,
                    "action": "flagged_by_scan",
                    "actor": ACTOR,
                    "reason": "fingerprint_match",
                    "notes": (
                        f"backfilled from copyright_scans #{scan.id}, "
                        f"scanned {scan.scanned_at:%Y-%m-%d}"
                    ),
                },
            )
            r.raise_for_status()
            opened += 1

    if dry_run:
        print("\ndry run — no events written")
    else:
        print(f"\nopened {opened} review item(s); notified nobody")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default="prod", choices=["dev", "staging", "prod"])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.env, args.dry_run)))
