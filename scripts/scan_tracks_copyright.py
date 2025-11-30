#!/usr/bin/env -S uv run --script --quiet
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "httpx",
#     "pydantic-settings",
#     "sqlalchemy[asyncio]",
#     "psycopg[binary]",
#     "logfire[sqlalchemy]",
# ]
# ///
"""scan all tracks for copyright using the moderation service.

usage:
    uv run scripts/scan_tracks_copyright.py --env staging
    uv run scripts/scan_tracks_copyright.py --env prod --dry-run
    uv run scripts/scan_tracks_copyright.py --env staging --limit 10

this will:
- fetch all tracks that haven't been scanned yet
- call the moderation service for each track
- store results in copyright_scans table

environment variables (set in .env or export):
    # database URLs per environment
    DEV_DATABASE_URL - dev database connection string
    STAGING_DATABASE_URL - staging database connection string
    PROD_DATABASE_URL - production database connection string

    # moderation service
    MODERATION_SERVICE_URL - URL of moderation service (default: https://plyr-moderation.fly.dev)
    MODERATION_AUTH_TOKEN - auth token for moderation service
"""

import asyncio
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import httpx
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend" / "src"))


Environment = Literal["dev", "staging", "prod"]


class ScanSettings(BaseSettings):
    """settings for copyright scan script."""

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
        default="https://plyr-moderation.fly.dev",
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


def setup_env(settings: ScanSettings, env: Environment) -> None:
    """setup environment variables for backend imports."""
    os.environ["DATABASE_URL"] = settings.get_database_url(env)


async def scan_track(
    client: httpx.AsyncClient,
    settings: ScanSettings,
    audio_url: str,
) -> dict:
    """call moderation service to scan a track."""
    response = await client.post(
        f"{settings.moderation_service_url}/scan",
        json={"audio_url": audio_url},
        headers={"X-Moderation-Key": settings.moderation_auth_token},
        timeout=120.0,  # scans can take a while
    )
    response.raise_for_status()
    return response.json()


async def run_scan(
    env: Environment,
    dry_run: bool = False,
    limit: int | None = None,
) -> None:
    """scan all tracks for copyright."""
    # load settings
    settings = ScanSettings()

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
        # find tracks without scans
        scanned_subq = select(CopyrightScan.track_id)
        stmt = (
            select(Track)
            .options(joinedload(Track.artist))
            .where(Track.id.notin_(scanned_subq))
            .where(Track.r2_url.isnot(None))
            .order_by(Track.created_at.desc())
        )

        if limit:
            stmt = stmt.limit(limit)

        result = await db.execute(stmt)
        tracks = result.scalars().unique().all()

        if not tracks:
            print("\n✅ all tracks have been scanned")
            return

        print(f"\n📋 found {len(tracks)} tracks to scan")

        if dry_run:
            print("\n[DRY RUN] would scan:")
            for track in tracks:
                print(f"  - {track.id}: {track.title} by @{track.artist.handle}")
            return

        # scan tracks
        async with httpx.AsyncClient() as client:
            scanned = 0
            failed = 0
            flagged = 0

            for i, track in enumerate(tracks, 1):
                print(f"\n[{i}/{len(tracks)}] scanning: {track.title}")
                print(f"  artist: @{track.artist.handle}")
                print(f"  url: {track.r2_url}")

                try:
                    result = await scan_track(client, settings, track.r2_url)

                    # create scan record
                    scan = CopyrightScan(
                        track_id=track.id,
                        scanned_at=datetime.now(UTC),
                        is_flagged=result["is_flagged"],
                        highest_score=result["highest_score"],
                        matches=result["matches"],
                        raw_response=result["raw_response"],
                    )
                    db.add(scan)
                    await db.commit()

                    scanned += 1
                    if result["is_flagged"]:
                        flagged += 1
                        print(f"  ⚠️  FLAGGED (score: {result['highest_score']})")
                        for match in result["matches"][:3]:
                            print(
                                f"     - {match['artist']} - {match['title']} ({match['score']})"
                            )
                    else:
                        print(f"  ✓ clear (score: {result['highest_score']})")

                except httpx.HTTPStatusError as e:
                    failed += 1
                    print(f"  ❌ HTTP error: {e.response.status_code}")
                    try:
                        print(f"     {e.response.json()}")
                    except Exception:
                        print(f"     {e.response.text[:200]}")
                except Exception as e:
                    failed += 1
                    print(f"  ❌ error: {e}")

        print(f"\n{'=' * 50}")
        print("✅ scan complete")
        print(f"   scanned: {scanned}")
        print(f"   flagged: {flagged}")
        print(f"   failed: {failed}")


def main() -> None:
    """main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="scan tracks for copyright")
    parser.add_argument(
        "--env",
        type=str,
        required=True,
        choices=["dev", "staging", "prod"],
        help="environment to scan",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="show what would be scanned without making changes",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="limit number of tracks to scan",
    )

    args = parser.parse_args()

    print(f"🔍 copyright scan - {args.env}")
    print("=" * 50)

    asyncio.run(run_scan(args.env, args.dry_run, args.limit))


if __name__ == "__main__":
    main()
