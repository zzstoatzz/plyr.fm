#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["asyncpg", "boto3", "pydantic", "pydantic-settings", "typer"]
# ///
"""export platform costs to R2 for public dashboard

usage:
    uv run scripts/costs/export_costs.py              # export to R2 (prod)
    uv run scripts/costs/export_costs.py --dry-run    # print JSON, don't upload
    uv run scripts/costs/export_costs.py --env stg    # use staging db
"""

import asyncio
import json
import os
import re
from datetime import UTC, datetime, timedelta
from typing import Any

import typer
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# fixed monthly costs (updated 2025-12-26)
# fly.io: manually updated from cost explorer (TODO: use fly billing API)
# neon: fixed $5/month
# cloudflare: mostly free tier
# redis: self-hosted on fly (included in fly_io costs)
FIXED_COSTS = {
    "fly_io": {
        "breakdown": {
            "relay-api": 5.80,  # prod backend
            "relay-api-staging": 5.60,
            "plyr-moderation": 0.24,
            "plyr-transcoder": 0.02,
        },
        "note": "compute (2x shared-cpu VMs + moderation + transcoder)",
    },
    "neon": {
        "total": 5.00,
        "note": "postgres serverless (fixed)",
    },
    "cloudflare": {
        "r2": 0.16,
        "pages": 0.00,
        "domain": 1.00,
        "total": 1.16,
        "note": "r2 egress is free, pages free tier",
    },
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "backend/.env"), extra="ignore")

    neon_database_url: str | None = None
    neon_database_url_prd: str | None = None
    neon_database_url_stg: str | None = None
    neon_database_url_dev: str | None = None

    # r2 stats bucket (dedicated, shared across environments)
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    r2_endpoint_url: str = ""
    r2_stats_bucket: str = Field(
        default="plyr-stats", validation_alias="R2_STATS_BUCKET"
    )
    r2_stats_public_url: str = Field(
        default="https://pub-68f2c7379f204d81bdf65152b0ff0207.r2.dev",
        validation_alias="R2_STATS_PUBLIC_URL",
    )

    def get_db_url(self, env: str) -> str:
        """get database url for environment, converting to asyncpg format"""
        url = getattr(self, f"neon_database_url_{env}", None) or self.neon_database_url
        if not url:
            raise ValueError(f"no database url for {env}")
        return re.sub(r"postgresql\+\w+://", "postgresql://", url)


settings = Settings()
app = typer.Typer(add_completion=False)


async def get_scan_stats(db_url: str) -> dict[str, Any]:
    """fetch copyright scan stats from postgres."""
    import asyncpg

    # 30 days of history for the daily chart
    history_start = datetime.now() - timedelta(days=30)

    conn = await asyncpg.connect(db_url)
    try:
        row = await conn.fetchrow(
            """
            SELECT
                COUNT(*) as total_scans,
                COUNT(CASE WHEN cs.is_flagged THEN 1 END) as flagged
            FROM copyright_scans cs
            WHERE cs.scanned_at >= $1
            """,
            history_start,
        )
        total_scans = row["total_scans"]
        flagged = row["flagged"]

        daily = await conn.fetch(
            """
            SELECT
                DATE(cs.scanned_at) as date,
                COUNT(*) as scans,
                COUNT(CASE WHEN cs.is_flagged THEN 1 END) as flagged
            FROM copyright_scans cs
            WHERE cs.scanned_at >= $1
            GROUP BY DATE(cs.scanned_at)
            ORDER BY date
            """,
            history_start,
        )

        return {
            "total_scans": total_scans,
            "flagged": flagged,
            "flag_rate": round(flagged / total_scans * 100, 1) if total_scans else 0,
            "daily": [
                {
                    "date": r["date"].isoformat(),
                    "scans": r["scans"],
                    "flagged": r["flagged"],
                }
                for r in daily
            ],
        }
    finally:
        await conn.close()


def build_cost_data(scan_stats: dict[str, Any]) -> dict[str, Any]:
    """assemble full cost dashboard data"""
    plyr_fly = sum(FIXED_COSTS["fly_io"]["breakdown"].values())

    monthly_total = (
        plyr_fly + FIXED_COSTS["neon"]["total"] + FIXED_COSTS["cloudflare"]["total"]
    )

    return {
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "monthly_estimate": round(monthly_total, 2),
        "costs": {
            "fly_io": {
                "amount": round(plyr_fly, 2),
                "breakdown": FIXED_COSTS["fly_io"]["breakdown"],
                "note": FIXED_COSTS["fly_io"]["note"],
            },
            "neon": {
                "amount": FIXED_COSTS["neon"]["total"],
                "note": FIXED_COSTS["neon"]["note"],
            },
            "cloudflare": {
                "amount": FIXED_COSTS["cloudflare"]["total"],
                "breakdown": {
                    "r2_storage": FIXED_COSTS["cloudflare"]["r2"],
                    "pages": FIXED_COSTS["cloudflare"]["pages"],
                    "domain": FIXED_COSTS["cloudflare"]["domain"],
                },
                "note": FIXED_COSTS["cloudflare"]["note"],
            },
            "copyright_scanning": {
                "amount": 0,
                "scans_30d": scan_stats["total_scans"],
                "flagged_30d": scan_stats["flagged"],
                "flag_rate": scan_stats["flag_rate"],
                "daily": scan_stats["daily"],
                "note": "free (AcoustID + fpcalc)",
            },
        },
        "support": {
            "url": "https://atprotofans.com/u/did:plc:xbtmt2zjwlrfegqvch7fboei",
            "message": "help cover moderation costs",
        },
    }


async def upload_to_r2(data: dict[str, Any]) -> str:
    """upload json to dedicated stats bucket"""
    import boto3

    bucket = settings.r2_stats_bucket
    key = "costs.json"
    body = json.dumps(data, indent=2).encode()

    s3 = boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json",
        CacheControl="public, max-age=3600",
    )
    return f"{settings.r2_stats_public_url}/{key}"


@app.command()
def main(
    dry_run: bool = typer.Option(
        False, "--dry-run", "-n", help="print json, don't upload"
    ),
    env: str = typer.Option("prd", "--env", "-e", help="environment: prd, stg, dev"),
) -> None:
    """export platform costs to R2 for public dashboard"""
    if not os.environ.get("CI") and not dry_run:
        typer.echo("costs export should only run in CI (GitHub Actions)")
        typer.echo("  use --dry-run for local testing")
        raise typer.Exit(1)

    async def run():
        db_url = settings.get_db_url(env)
        scan_stats = await get_scan_stats(db_url)
        data = build_cost_data(scan_stats)

        if dry_run:
            print(json.dumps(data, indent=2))
            return

        url = await upload_to_r2(data)
        print(f"uploaded to {url}")

    asyncio.run(run())


if __name__ == "__main__":
    app()
