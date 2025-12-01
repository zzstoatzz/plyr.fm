#!/usr/bin/env -S uv run --script --quiet --with-editable=backend
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "httpx",
#     "pydantic-settings",
# ]
# ///
"""backfill label context from copyright_scans to moderation service.

this script reads flagged tracks from the backend database and populates
the label_context table in the moderation service database. it does NOT
emit new labels - it only adds context to existing labels.

usage:
    uv run scripts/backfill_label_context.py --env prod --dry-run
    uv run scripts/backfill_label_context.py --env prod

environment variables (set in .env or export):
    PROD_DATABASE_URL - production database connection string
    STAGING_DATABASE_URL - staging database connection string
    MODERATION_SERVICE_URL - URL of moderation service (default: https://moderation.plyr.fm)
    MODERATION_AUTH_TOKEN - auth token for moderation service
"""

import asyncio
import os
import sys
from typing import Any, Literal

import httpx
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


Environment = Literal["dev", "staging", "prod"]


class BackfillSettings(BaseSettings):
    """settings for backfill script."""

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="ignore",
    )

    dev_database_url: str = Field(default="", validation_alias="DEV_DATABASE_URL")
    staging_database_url: str = Field(
        default="", validation_alias="STAGING_DATABASE_URL"
    )
    prod_database_url: str = Field(default="", validation_alias="PROD_DATABASE_URL")

    moderation_service_url: str = Field(
        default="https://moderation.plyr.fm",
        validation_alias="MODERATION_SERVICE_URL",
    )
    moderation_auth_token: str = Field(
        default="", validation_alias="MODERATION_AUTH_TOKEN"
    )

    def get_database_url(self, env: Environment) -> str:
        """get database URL for environment."""
        urls = {
            "dev": self.dev_database_url,
            "staging": self.staging_database_url,
            "prod": self.prod_database_url,
        }
        url = urls.get(env, "")
        if not url:
            raise ValueError(f"no database URL configured for {env}")
        return url


def setup_env(settings: BackfillSettings, env: Environment) -> None:
    """setup environment variables for backend imports."""
    db_url = settings.get_database_url(env)
    # ensure asyncpg driver is used
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    # asyncpg uses 'ssl' not 'sslmode' - convert the parameter
    db_url = db_url.replace("sslmode=require", "ssl=require")
    os.environ["DATABASE_URL"] = db_url


async def store_context(
    client: httpx.AsyncClient,
    settings: BackfillSettings,
    uri: str,
    context: dict[str, Any],
) -> bool:
    """store context directly via emit-label endpoint.

    we send a "dummy" emit that just stores context for an existing label.
    the moderation service will upsert the context without creating a new label
    if we use neg=false and the label already exists (it just updates context).

    actually, we need a dedicated endpoint for this. let's use a workaround:
    call emit-label with the context - it will store the context even though
    the label already exists (store_context uses ON CONFLICT DO UPDATE).
    """
    try:
        # we need to call emit-label to trigger context storage
        # but we don't want to create duplicate labels
        # the backend will reject duplicate labels, so we just send context
        # via a new endpoint we need to add... or we can use a hack:
        # just POST to emit-label with context - it will store label + context
        # but since label already exists, we'll get an error... hmm

        # actually, looking at the code, store_label will create a new label row
        # each time (no unique constraint on uri+val). that's intentional for
        # labeler protocol. so we can't use emit-label for backfill.

        # we need a dedicated endpoint. let's add /admin/context for this.
        response = await client.post(
            f"{settings.moderation_service_url}/admin/context",
            json={
                "uri": uri,
                "context": context,
            },
            headers={"X-Moderation-Key": settings.moderation_auth_token},
            timeout=30.0,
        )
        response.raise_for_status()
        return True
    except httpx.HTTPStatusError as e:
        print(f"  ❌ HTTP error: {e.response.status_code}")
        try:
            print(f"     {e.response.json()}")
        except Exception:
            print(f"     {e.response.text[:200]}")
        return False
    except Exception as e:
        print(f"  ❌ error: {e}")
        return False


async def run_backfill(env: Environment, dry_run: bool = False) -> None:
    """backfill label context from copyright_scans."""
    settings = BackfillSettings()

    # validate settings
    try:
        db_url = settings.get_database_url(env)
        print(
            f"✓ database: {db_url.split('@')[1].split('/')[0] if '@' in db_url else 'configured'}"
        )
    except ValueError as e:
        print(f"❌ {e}")
        print(f"\nset {env.upper()}_DATABASE_URL in .env")
        sys.exit(1)

    if not settings.moderation_auth_token:
        print("❌ MODERATION_AUTH_TOKEN not set")
        sys.exit(1)

    print(f"✓ moderation service: {settings.moderation_service_url}")

    # setup env before backend imports
    setup_env(settings, env)

    # import backend after env setup
    from sqlalchemy import select
    from sqlalchemy.orm import joinedload

    from backend.models import CopyrightScan, Track
    from backend.utilities.database import db_session

    async with db_session() as db:
        # find flagged tracks with atproto URIs and their scan results
        stmt = (
            select(Track, CopyrightScan)
            .options(joinedload(Track.artist))
            .join(CopyrightScan, CopyrightScan.track_id == Track.id)
            .where(CopyrightScan.is_flagged.is_(True))
            .where(Track.atproto_record_uri.isnot(None))
            .order_by(Track.created_at.desc())
        )

        result = await db.execute(stmt)
        rows = result.unique().all()

        if not rows:
            print("\n✅ no flagged tracks to backfill context for")
            return

        print(f"\n📋 found {len(rows)} flagged tracks with context to backfill")

        if dry_run:
            print("\n[DRY RUN] would store context for:")
            for track, scan in rows:
                print(f"  - {track.id}: {track.title} by @{track.artist.handle}")
                print(f"    uri: {track.atproto_record_uri}")
                print(
                    f"    score: {scan.highest_score}, matches: {len(scan.matches or [])}"
                )
            return

        # store context for each track
        async with httpx.AsyncClient() as client:
            stored = 0
            failed = 0

            for i, (track, scan) in enumerate(rows, 1):
                print(f"\n[{i}/{len(rows)}] storing context for: {track.title}")
                print(f"  artist: @{track.artist.handle}")
                print(f"  uri: {track.atproto_record_uri}")

                context = {
                    "track_title": track.title,
                    "artist_handle": track.artist.handle if track.artist else None,
                    "artist_did": track.artist_did,
                    "highest_score": scan.highest_score,
                    "matches": scan.matches,
                }

                success = await store_context(
                    client,
                    settings,
                    track.atproto_record_uri,
                    context,
                )

                if success:
                    stored += 1
                    print("  ✓ context stored")
                else:
                    failed += 1

        print(f"\n{'=' * 50}")
        print("✅ backfill complete")
        print(f"   stored: {stored}")
        print(f"   failed: {failed}")


def main() -> None:
    """main entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="backfill label context from copyright_scans"
    )
    parser.add_argument(
        "--env",
        type=str,
        required=True,
        choices=["dev", "staging", "prod"],
        help="environment to backfill",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="show what would be stored without making changes",
    )

    args = parser.parse_args()

    print(f"🏷️  label context backfill - {args.env}")
    print("=" * 50)

    asyncio.run(run_backfill(args.env, args.dry_run))


if __name__ == "__main__":
    main()
