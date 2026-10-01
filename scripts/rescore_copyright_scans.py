#!/usr/bin/env -S uv run --script --quiet --with-editable=backend
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "httpx",
#     "pydantic-settings",
# ]
# ///
"""Re-derive `copyright_scans.is_flagged` from the matches already stored.

The flag rule changed from "one song is most of the matches" to "a reference
recording plays in step with the upload" (see
docs/internal/moderation/copyright-detection.md). Stored scans keep their raw
matches, so the new rule can be applied without calling AuDD again.

It writes only `is_flagged` and `raw_response.evidence`. It opens no review
items and notifies nobody; run `backfill_moderation_queue.py` afterwards to put
newly flagged tracks in front of a moderator. A scan whose flag a moderator
already dismissed (a negated label) is left alone.

usage:
    ./scripts/rescore_copyright_scans.py --env prod --dry-run
    ./scripts/rescore_copyright_scans.py --env prod

in CI the logs are public, so the workflow passes --quiet: counts only.
"""

import argparse
import asyncio
import os
import re
import sys
from typing import Literal

import httpx
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from _moderation import DEFAULT_SERVICE_URL

Environment = Literal["dev", "staging", "prod"]


class RescoreSettings(BaseSettings):
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
        return re.sub(r"^postgres(ql)?(\+\w+)?://", "postgresql+psycopg://", url)


async def main(env: Environment, dry_run: bool, quiet: bool) -> int:
    settings = RescoreSettings()
    if not settings.moderation_auth_token:
        print("MODERATION_AUTH_TOKEN is required")
        return 1

    os.environ["DATABASE_URL"] = settings.database_url(env)

    from backend.utilities.copyright_evidence import is_self_match, song_evidence
    from backend.models import CopyrightScan, Track
    from backend.utilities.database import db_session
    from sqlalchemy import select
    from sqlalchemy.orm import joinedload

    async with db_session() as db:
        rows = (
            (
                await db.execute(
                    select(CopyrightScan, Track)
                    .join(Track, CopyrightScan.track_id == Track.id)
                    .options(joinedload(Track.artist))
                    .order_by(CopyrightScan.track_id)
                )
            )
            .unique()
            .all()
        )

        uris = [t.atproto_record_uri for _, t in rows if t.atproto_record_uri]
        async with httpx.AsyncClient(
            base_url=settings.moderation_service_url,
            headers={"X-Moderation-Key": settings.moderation_auth_token},
            timeout=30.0,
        ) as client:
            r = await client.post("/internal/negated-labels", json={"uris": uris})
            r.raise_for_status()
            dismissed = set(r.json().get("negated_uris", []))

        raised = lowered = 0
        for scan, track in rows:
            evidence = song_evidence(scan.matches or [])
            others = [
                e
                for e in evidence
                if not is_self_match(
                    e.artist, track.artist.handle, track.artist.display_name or ""
                )
            ]
            flagged = bool(others) and track.atproto_record_uri not in dismissed
            if flagged != scan.is_flagged:
                raised += flagged
                lowered += not flagged
                found = (
                    f"{others[0].artist} - {others[0].title}, "
                    f"{others[0].in_step_segments} segments in step"
                    if others
                    else "nothing plays in step"
                )
                if not quiet:
                    print(
                        f"  [{'flag' if flagged else 'clear'}] track {track.id} "
                        f"@{track.artist.handle}: {track.title[:40]!r} ({found})"
                    )
            if dry_run:
                continue
            scan.is_flagged = flagged
            scan.raw_response = {
                **(scan.raw_response or {}),
                "evidence": [e.as_dict() for e in evidence],
            }

        if not dry_run:
            await db.commit()

    print(f"\n{len(rows)} scan(s): {raised} newly flagged, {lowered} cleared")
    print("dry run — nothing written" if dry_run else "written; notified nobody")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default="prod", choices=["dev", "staging", "prod"])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--quiet", action="store_true", help="print counts only (public CI logs)"
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.env, args.dry_run, args.quiet)))
