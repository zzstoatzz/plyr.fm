#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "httpx",
#     "pydantic-settings",
#     "sqlalchemy[asyncio]",
#     "asyncpg",
#     "logfire[sqlalchemy]",
# ]
# ///
"""backfill copyright labels for flagged tracks.

usage:
    uv run scripts/backfill_copyright_labels.py --env prod --dry-run
    uv run scripts/backfill_copyright_labels.py --env prod

this will:
- fetch all tracks flagged in copyright_scans that have atproto_record_uri
- emit labels to the moderation service for each flagged track

environment variables (set in .env or export):
    PROD_DATABASE_URL - production database connection string
    STAGING_DATABASE_URL - staging database connection string
    MODERATION_SERVICE_URL - URL of moderation service (default: https://moderation.plyr.fm)
    MODERATION_AUTH_TOKEN - auth token for moderation service
"""

import asyncio
import os
import sys
from pathlib import Path
from typing import Literal

import httpx
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend" / "src"))


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


async def emit_label(
    client: httpx.AsyncClient,
    settings: BackfillSettings,
    uri: str,
    cid: str | None,
) -> bool:
    """emit a copyright-violation label for a track."""
    try:
        response = await client.post(
            f"{settings.moderation_service_url}/emit-label",
            json={
                "uri": uri,
                "val": "copyright-violation",
                "cid": cid,
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
    """backfill copyright labels for flagged tracks."""
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
        # find flagged tracks with atproto URIs
        stmt = (
            select(Track)
            .options(joinedload(Track.artist))
            .join(CopyrightScan, CopyrightScan.track_id == Track.id)
            .where(CopyrightScan.is_flagged.is_(True))
            .where(Track.atproto_record_uri.isnot(None))
            .order_by(Track.created_at.desc())
        )

        result = await db.execute(stmt)
        tracks = result.scalars().unique().all()

        if not tracks:
            print("\n✅ no flagged tracks need label backfill")
            return

        print(f"\n📋 found {len(tracks)} flagged tracks with ATProto URIs")

        if dry_run:
            print("\n[DRY RUN] would emit labels for:")
            for track in tracks:
                print(f"  - {track.id}: {track.title} by @{track.artist.handle}")
                print(f"    uri: {track.atproto_record_uri}")
            return

        # emit labels
        async with httpx.AsyncClient() as client:
            emitted = 0
            failed = 0

            for i, track in enumerate(tracks, 1):
                print(f"\n[{i}/{len(tracks)}] emitting label for: {track.title}")
                print(f"  artist: @{track.artist.handle}")
                print(f"  uri: {track.atproto_record_uri}")

                success = await emit_label(
                    client,
                    settings,
                    track.atproto_record_uri,
                    track.atproto_record_cid,
                )

                if success:
                    emitted += 1
                    print("  ✓ label emitted")
                else:
                    failed += 1

        print(f"\n{'=' * 50}")
        print("✅ backfill complete")
        print(f"   emitted: {emitted}")
        print(f"   failed: {failed}")


def main() -> None:
    """main entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="backfill copyright labels for flagged tracks"
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
        help="show what would be emitted without making changes",
    )

    args = parser.parse_args()

    print(f"🏷️  copyright label backfill - {args.env}")
    print("=" * 50)

    asyncio.run(run_backfill(args.env, args.dry_run))


if __name__ == "__main__":
    main()
