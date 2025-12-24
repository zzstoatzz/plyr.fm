#!/usr/bin/env -S uv run --script --quiet --with-editable=backend
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "httpx",
#     "pydantic-settings",
#     "asyncpg",
#     "sqlalchemy[asyncio]",
# ]
# ///
"""migrate sensitive images from backend database to moderation service.

this script reads sensitive images from the backend database and creates
them in the moderation service. after migration, the backend will proxy
sensitive image requests to the moderation service.

usage:
    uv run scripts/migrate_sensitive_images.py --env prod --dry-run
    uv run scripts/migrate_sensitive_images.py --env prod

environment variables (set in .env or export):
    PROD_DATABASE_URL - production database connection string
    STAGING_DATABASE_URL - staging database connection string
    DEV_DATABASE_URL - development database connection string
    MODERATION_SERVICE_URL - URL of moderation service
    MODERATION_AUTH_TOKEN - auth token for moderation service
"""

import argparse
import asyncio
import os
from typing import Literal

import httpx
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

Environment = Literal["dev", "staging", "prod"]


class MigrationSettings(BaseSettings):
    """settings for migration script."""

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
        # ensure asyncpg driver is used
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url

    def get_moderation_url(self, env: Environment) -> str:
        """get moderation service URL for environment."""
        if env == "dev":
            return os.getenv("DEV_MODERATION_URL", "http://localhost:8002")
        elif env == "staging":
            return os.getenv("STAGING_MODERATION_URL", "https://moderation-stg.plyr.fm")
        else:
            return self.moderation_service_url


async def fetch_sensitive_images(db_url: str) -> list[dict]:
    """fetch all sensitive images from backend database."""
    engine = create_async_engine(db_url)

    async with engine.begin() as conn:
        result = await conn.execute(
            text(
                """
                SELECT id, image_id, url, reason, flagged_at, flagged_by
                FROM sensitive_images
                ORDER BY id
                """
            )
        )
        rows = result.fetchall()

    await engine.dispose()

    return [
        {
            "id": row[0],
            "image_id": row[1],
            "url": row[2],
            "reason": row[3],
            "flagged_at": row[4].isoformat() if row[4] else None,
            "flagged_by": row[5],
        }
        for row in rows
    ]


async def migrate_to_moderation_service(
    images: list[dict],
    moderation_url: str,
    auth_token: str,
    dry_run: bool = False,
) -> tuple[int, int]:
    """migrate images to moderation service.

    returns:
        tuple of (success_count, error_count)
    """
    success_count = 0
    error_count = 0

    headers = {"X-Moderation-Key": auth_token}

    async with httpx.AsyncClient(timeout=30.0) as client:
        for image in images:
            payload = {
                "image_id": image["image_id"],
                "url": image["url"],
                "reason": image["reason"],
                "flagged_by": image["flagged_by"],
            }

            if dry_run:
                print(f"  [dry-run] would migrate: {payload}")
                success_count += 1
                continue

            try:
                response = await client.post(
                    f"{moderation_url}/admin/sensitive-images",
                    json=payload,
                    headers=headers,
                )
                response.raise_for_status()
                result = response.json()
                print(f"  migrated id={image['id']} -> moderation id={result['id']}")
                success_count += 1
            except Exception as e:
                print(f"  ERROR migrating id={image['id']}: {e}")
                error_count += 1

    return success_count, error_count


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="migrate sensitive images to moderation service"
    )
    parser.add_argument(
        "--env",
        choices=["dev", "staging", "prod"],
        required=True,
        help="environment to migrate",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="show what would be migrated without making changes",
    )
    args = parser.parse_args()

    settings = MigrationSettings()

    print(f"migrating sensitive images for {args.env}")
    if args.dry_run:
        print("(dry run - no changes will be made)")

    # fetch from backend database
    db_url = settings.get_database_url(args.env)
    print("\nfetching from backend database...")
    images = await fetch_sensitive_images(db_url)
    print(f"found {len(images)} sensitive images")

    if not images:
        print("nothing to migrate")
        return

    # migrate to moderation service
    moderation_url = settings.get_moderation_url(args.env)
    print(f"\nmigrating to moderation service at {moderation_url}...")

    if not settings.moderation_auth_token and not args.dry_run:
        print("ERROR: MODERATION_AUTH_TOKEN not set")
        return

    success, errors = await migrate_to_moderation_service(
        images,
        moderation_url,
        settings.moderation_auth_token,
        dry_run=args.dry_run,
    )

    print(f"\ndone: {success} migrated, {errors} errors")

    if not args.dry_run and errors == 0:
        print(
            "\nnext steps:\n"
            "  1. verify data in moderation service: GET /sensitive-images\n"
            "  2. update backend to proxy to moderation service\n"
            "  3. optionally drop sensitive_images table from backend db"
        )


if __name__ == "__main__":
    asyncio.run(main())
